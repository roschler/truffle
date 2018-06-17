var OS = require("os");
var dir = require("node-dir");
var path = require("path");
var async = require("async");
var debug = require("debug")("lib:debug");
var Web3 = require("web3");

var commandReference = {
  "o": "step over",
  "i": "step into",
  "u": "step out",
  "n": "step next",
  ";": "step instruction",
  "p": "print instruction",
  "h": "print this help",
  "v": "print variables and values",
  ":": "evaluate expression - see `v`",
  "+": "add watch expression (`+:<expr>`)",
  "-": "remove watch expression (-:<expr>)",
  "?": "list existing watch expressions",
  "b": "toggle breakpoint",
  "c": "continue until breakpoint",
  "q": "quit"
};


var DebugUtils = {
	
  /**
   * Small object to associate a contract binary with the relevant
   *  contract name.
   *
   * @property {String} contractName - The contract name.
   * @property {String} binary - The contract byte code belonging to the
   *  named contract.
   *
   * @constructor
   */
  ContractNameAndBinary: function()
  {
    this.contractName = "";
    this.binary = "";
  },

  /**
   * Small object to associate a contract address with the relevant
   *  contract name.
   *
   * @property {String} contractName - The contract name.
   * @property {String} address - The addres of the contract's
   *  deployment
   *
   * @constructor
   */
  ContractNameAndAddress: function()
  {
    this.contractName = "";
    this.address = "";
  },

  /**
   * Small object to contain a contract reference, it's associated JSON
   *  artifact (if any), an error flag, and a test result message.
   *
   *  @property {Boolean} isError - If TRUE, the validation test failed
   *    for the target contract.  If FALSE, then the test succeeded.
   *  @property {Object} contract - A contract object.
   *  @property {Object} artifact - An artifact object derived from the
   *    contract's JSON file.  Note, this may be NULL if the artifact
   *    JSON file is missing.
   *  @property {String} testResultMessage - The associated test result or error message,
   *    depending on the results of the test.
   *
   * @constructor
   */
  ValidationTestResult: function()
  {
    // Initialize.
    this.isError = false;
    this.contractName = "";
    this.artifact = null;
    this.testResultMessage = "";
    
    /**
     * Returns a human friendly formatted error message that reflects
     *  the current content of this object.
     */
    this.formattedTestResultMessage = function()
    {
      let successFailMsg = this.isError ? "FAILED" : "SUCCESS"
      return "[contract: " + this.contractName + "] " + successFailMsg + " -> Details: " + this.testResultMessage;
    }
  },

  /**
   * This object contains the result of a contracts validation
   *  operation.
   *
   * @property {Boolean} isError - TRUE if one or more of the contracts
   *  failed the validation tests.  FALSE if not.
   * @property {String} overallResultsMessage - If an error occurred, this property
   *  will contain the top level error message for the validation failure.  If not,
   *  it will contain an overall success message.
   * @property {Array} aryErrFailedContracts - If an error occurred, this
   *  property will contain a ContractValidationError object for each
   *  contract that failed validation.
   *
   * @constructor
   */
  ContractValidationResults: function()
  {
    // Initialize properties.
    this.isError = false;
    this.overallResultsMessage = "";
    this.aryTestResults = new Array();
    
    /**
     * Add a test result for one of the contracts involved in a debug
     *  session during the validation test phase.
     *
     * @param {Object} contractName - The name of the offending contract.
     * @param {Object} artifact - The associated JSON artifact.  May be NULL
     *  if the artifact file could not be found for the given contract.  Can
     *  not be "undefined".
     * @param {String} testResultMsg - A descriptive test result message.
     */
    this._addTestResult = function(contractName, artifact, testResultMsg)
    {
      let testResult = new DebugUtils.ValidationTestResult();
      
      testResult.contractName = contractName;
      testResult.artifact = artifact;
      testResult.testResultMessage = testResultMsg;
      
      this.aryTestResults.push(testResult);
	}
      
    /**
     * Add a validation error for one of the contracts involved in a debug
     *  session.
     *
     * @param {Object} contractName - The name of the offending contract.
     * @param {Object} artifact - The associated JSON artifact.  May be NULL
     *  if the artifact file could not be found for the given contract.  Can
     *  not be "undefined".
     * @param {String} errMsg - A descriptive error message.
     */
    this.addValidationError = function(contractName, artifact, errMsg) {
      this.isError = true;
      
      this._addTestResult(contractName, artifact, errMsg);
    }
    
    /**
     * Add the results of a successful validaiton test for one of the contracts
     *  involved in a debug session.
     *
     * @param {Object} contractName - The name of the contract tested.
     * @param {Object} artifact - The associated JSON artifact.  May be NULL
     *  if the artifact file could not be found for the given contract.  Can
     *  not be "undefined".
     * @param {String} resultMsg - A descriptive test result message.
     */
    this.addSuccessfulTestResult = function(contractName, artifact, resultMsg) {
      this.isError = false;
      
      this._addTestResult(contractName, artifact, resultMsg);
    }
    
    /**
     * Returns a human friendly formatted error message that reflects
     *  the current content of this object.
     */
    this.formattedTestResultsMessage = function()
    {
      let resultsMsg = this.overallResultsMessage;
      
      if (this.aryTestResults.length > 0)
      {
        for (let ndx = 0; ndx < this.aryTestResults.length; ndx++)
          resultsMsg += "\n" + this.aryTestResults[ndx].formattedTestResultMessage();
      }
  
      resultsMsg += "\n";
      
      return resultsMsg;
    }
  },

  gatherArtifacts: function(config) {
    return new Promise((accept, reject) => {
      // Gather all available contract artifacts
      dir.files(config.contracts_build_directory, (err, files) => {
        if (err) return reject(err);

        var contracts = files.filter((file_path) => {
          return path.extname(file_path) == ".json";
        }).map((file_path) => {
          return path.basename(file_path, ".json");
        }).map((contract_name) => {
          return config.resolver.require(contract_name);
        });

        async.each(contracts, (abstraction, finished) => {
          abstraction.detectNetwork().then(() => {
            finished();
          }).catch(finished);
        }, (err) => {
          if (err) return reject(err);
          accept(contracts.map( (contract) => {
            debug("contract.sourcePath: %o", contract.sourcePath);

            return {
              contractName: contract.contractName,
              source: contract.source,
              sourceMap: contract.sourceMap,
              sourcePath: contract.sourcePath,
              binary: contract.binary,
              ast: contract.ast,
              deployedBinary: contract.deployedBinary,
              deployedSourceMap: contract.deployedSourceMap,
              // ROS: Returning the networks section so that the new networkBytecode field is
              // available.
              networks: contract.networks
            };
          }));
        });
      });
    });
  },

  formatStartMessage: function() {
    var lines = [
      "",
      "Gathering transaction data...",
      ""
    ];

    return lines.join(OS.EOL);
  },

  formatCommandDescription: function(commandId) {
    return "(" + commandId + ") " + commandReference[commandId];
  },

  formatAffectedInstances: function(instances) {
    var hasAllSource = true;

    var lines = Object.keys(instances).map(function(address) {
      var instance = instances[address];

      if (instance.contractName) {
        return " " + address + " - " + instance.contractName;
      }

      if (!instance.source) {
        hasAllSource = false;
      }

      return " " + address + "(UNKNOWN)";
    });


    if (!hasAllSource) {
      lines.push("");
      lines.push("Warning: The source code for one or more contracts could not be found.");
    }

    return lines.join(OS.EOL);
  },

  formatHelp: function(lastCommand) {
    if (!lastCommand) {
      lastCommand = "n";
    }

    var prefix = [
      "Commands:",
      "(enter) last command entered (" + commandReference[lastCommand] + ")"
    ];

    var commandSections = [
      ["o", "i", "u", "n"],
      [";", "p", "h", "q"],
      ["b", "c"],
      ["+", "-"],
      ["?"],
      ["v", ":"]
    ].map(function (shortcuts) {
      return shortcuts
        .map(DebugUtils.formatCommandDescription)
        .join(", ");
    })

    var suffix = [
      ""
    ];

    var lines = prefix.concat(commandSections).concat(suffix);

    return lines.join(OS.EOL);
  },

  formatLineNumberPrefix: function (line, number, cols, tab) {
    if (!tab) {
      tab = "  ";
    }

    var prefix = number + "";
    while (prefix.length < cols) {
      prefix = " " + prefix;
    }

    prefix += ": ";
    return prefix + line.replace(/\t/g, tab);
  },

  formatLinePointer: function(line, startCol, endCol, padding, tab) {
    if (!tab) {
      tab = "  ";
    }

    padding += 2; // account for ": "
    var prefix = "";
    while (prefix.length < padding) {
      prefix += " ";
    }

    var output = "";
    for (var i = 0; i < line.length; i++) {
      var pointedAt = (i >= startCol && i < endCol);
      var isTab = (line[i] == "\t");

      var additional;
      if (isTab) {
        additional = tab;
      } else {
        additional = " "; // just a space
      }

      if (pointedAt) {
        additional = additional.replace(/./g, "^");
      }

      output += additional;
    }

    return prefix + output;
  },

  formatRangeLines: function(source, range, contextBefore) {
    var outputLines = [];

    // range is {
    //   start: { line, column },
    //   end: { line, column}
    // }
    //

    if (contextBefore == undefined) {
      contextBefore = 2;
    };

    var startBeforeIndex = Math.max(
      range.start.line - contextBefore, 0
    );

    var prefixLength = ((range.start.line + 1) + "").length;

    var beforeLines = source
      .filter(function (line, index) {
        return index >= startBeforeIndex && index < range.start.line
      })
      .map(function (line, index) {
        var number = startBeforeIndex + index + 1;  // 1 to account for 0-index
        return DebugUtils.formatLineNumberPrefix(line, number, prefixLength)
      });

    var line = source[range.start.line];
    var number = range.start.line + 1; // zero-index

    var pointerStart = range.start.column;
    var pointerEnd;

    // range.end is undefined in some cases
    // null/undefined check to avoid exceptions
    if (range.end && range.start.line == range.end.line) {
      // start and end are same line: pointer ends at column
      pointerEnd = range.end.column;
    } else {
      pointerEnd = line.length;
    }

    var allLines = beforeLines.concat([
      DebugUtils.formatLineNumberPrefix(line, number, prefixLength),
      DebugUtils.formatLinePointer(line, pointerStart, pointerEnd, prefixLength)
    ]);

    return allLines.join(OS.EOL);
  },

  formatInstruction: function (traceIndex, instruction) {
    return (
      "(" + traceIndex + ") " +
        instruction.name + " " +
        (instruction.pushData || "")
    );
  },

  formatStack: function (stack) {
    var formatted = stack.map(function (item, index) {
      item = "  " + item;
      if (index == stack.length - 1) {
        item += " (top)";
      }

      return item;
    });

    if (stack.length == 0) {
      formatted.push("  No data on stack.");
    }

    return formatted.join(OS.EOL);
  },
  
  /**
   * getNetworkBytecode - Return a promise that gets the deployed code for
   *  a contract from the current network.
   *
   * NOTE: This function was sourced from the getDeployedCode() function
   *  found in the truffle-debugger module.
   * @param  {Object} web3Intf - A web3 interface for us to use
   * @param  {Object} logger - A logging provider.
   * @param  {String} address - The address of the contract whose byte code we want.
   *
   * @return {Promise} deployedBinary - Returns the actual byte code the network
   *  has for the contract whose address we provided.
   */
  getNetworkBytecode: function  (web3Intf, logger, address) {

    logger.log("Getting current snapshot of network byte code for contract address: %s", address);
    return new Promise((accept, reject) => {
      web3Intf.eth.getCode(address, (err, deployedBinary) => {
        if (err)
        {
          logger.log("Error during byte retrieval.  Error number: %o", err);
          return reject(err);
        }
        
        logger.log("Successfully retrieved network byte code for contract at address: %s", address);
        accept(deployedBinary);
      });
    });
  },
  
  /**
   * This function returns a promise that iterates the contracts
   *  passed to us and retrieves the actual byte code for each one from
   *  the current network using the web3 interface.
   *
   * @param  {Object} web3Intf - A web3 interface for us to use
   * @param  {Object} logger - A logging provider.
   * @param  {Array} aryContractNameAndAddress - An array of contract name and
   *  address pairs.
   *
   * @return {Promise} - Returns a promise that retrieves a fresh
   *  snapshot of all the binaries resident on the current network
   *  client for each of the specified contracts.
   */
  retrieveNetworkBytecodeAll: function(web3Intf, logger, aryContractNameAndAddress)
  {
    logger.log("Retrieving network byte code for " + aryContractNameAndAddress.length + " contracts.");
    
    // Build an array of promises that will get the network byte code
    //  for each contract in the contracts array.
    let aryPromises = new Array();
    let aryBinaries = new Array();
    
    // Create a promise that takes the binary returned from a getNetworkBytecode()
    //  promise and accumulates it into our array for those.
    let accumulateBinariesPromise = function(contractNameAndAddress)
      {
          return DebugUtils.getNetworkBytecode(web3Intf, logger, contractNameAndAddress.address)
          .then(function(binary) {
            let nameAndBinary = new DebugUtils.ContractNameAndBinary();
            
            nameAndBinary.contractName = contractNameAndAddress.contractName;
            nameAndBinary.binary = binary;
            
            aryBinaries.push(nameAndBinary);
          });
      }
    
    for (let ndx = 0; ndx < aryContractNameAndAddress.length; ndx++)
      // Get the byte code for the specified contract.
      aryPromises.push(new accumulateBinariesPromise(aryContractNameAndAddress[ndx]));
    
    // Return a promise that waits for all the promises to complete
    //  and then returns the accumulated binaries.
    return Promise.all(aryPromises)
    .then(function(dummy)
    {
      // Return the accumulated binaries.
      return aryBinaries;
    });
  },
 
  /**
   * This function returns a promise that iterates the contracts
   *  passed to us and retrieves the actual byte code for each one from
   *  the current network using the web3 interface.  The retrieved
   *  snapshots are then stored in the JSON artifacts in the network
   *  byte code field.
   *
   * @param  {Object} web3Intf - A web3 interface for us to use
   * @param  {Object} logger - A logging provider.
   * @param  {Array} truffleContracts - An array of Truffle contracts.
   *
   * @return {Promise}
   */
  retrieveAndStoreNetworkBytecodeAll: function(web3Intf, logger, truffleContracts)
  {
    logger.log("Retrieving network byte code for " + truffleContracts.length + " contracts.");
    
    // Canonicalize the contract name and address fields to an array of just those
    //  field pairs because that is what retrieveNetworkBytecodeAll() expects.
    let aryContractNameAndAddress = DebugUtils.truffleContractsToNameAndAddress(truffleContracts);
    
    return DebugUtils.retrieveNetworkBytecodeAll(web3Intf, logger, aryContractNameAndAddress)
    .then(function(aryNameAndBinary)
    {
      // We should now have an array of the contract names and the byte code
      //  snapshot retrieved for each of them.
      for (let ndx = 0; ndx < aryNameAndBinary.length; ndx++)
      {
        // Save each binary retrieved to the correct contract's network byte code field.
        let truffleContract = DebugUtils.selectTruffleContractFromArray(aryNameAndBinary[ndx].contractName, truffleContracts);
        let networkEntry = DebugUtils.selectNetworkEntryFromTruffleContract(truffleContract.network_id, truffleContract);
        
        networkEntry.networkBytecode = aryNameAndBinary[ndx].binary;
	  }
    });
  },
  
  /**
   * Given the ID for the currentn etwork client, and array of contract name and
   *  binary pairs, an array of JSON artifacts, and a contract validation
   *  results object, validate our contract archive images for the given contracts
   *  against the freshly fetched network byte code images retrieved from the
   *  current network client.
   *
   * @param {String} networkId - The desired network ID.
   * @param {Array} aryClientNetworkBinaries - An array of the client network binaries
   *  paired with the associated contract name.
   * @param {Array} artifacts - An array of JSON artifact objects.
   * @param {Object} validationResults - A contract validation test results object
   *  that will receive the results of our tests.
   *
   */
  _doTheValidation: function(networkId, aryClientNetworkBinaries, artifacts, validationResults)
  {
    // If we were unable to get any network snapshots than something is very
    //  wrong with the current configuration.  Abort.
    if (!aryClientNetworkBinaries || aryClientNetworkBinaries.length < 1)
      throw new Error("Unable to retrieve the latest network byte code snapshots from the current network.  Aborting debug session.");
  
    // Extract the binaries for the artifacts.
    let aryArtifactBinaries = DebugUtils.artifactsToNameAndBinary(networkId, artifacts);
  
    // We now have fresh network byte code snapshots for each deployed contract.  Validate
    //  each of them against the snapshots we saved during the last contract deployment for the
    //  current network ID.
    _.forEach(aryClientNetworkBinaries, function(clientNameAndBinary)
    {
      // Find the complementary artifact for the given client network byte code snapshots array.
      let matchingArtifact = _.find(aryArtifactBinaries, function(artifact){
          return clientNameAndBinary.contractName == artifact.contractName;
        });
        
      if (matchingArtifact)
      {
        // ---------------- BYTE CODE COMPARISON ------------------
        
        // Finally, we can compare the network byte code for what is active
        //  on the current network client and what we stored during the
        //  last deployment.
        //
        // Network byte code images match?
        if (clientNameAndBinary.binary == matchingArtifact.networkBytecode)
        {
          // Success.  Add that to the report.
          validationResults.addSuccessfulTestResult(
            clientNameAndBinary.contractName,
            matchingArtifact,
            "Byte code images match, contract image validated.")
        }
        else
        {
          // The network byte code running the current client does not match what we
          //  stored during the last deployment.  Add an error message for that.
          validationResults.addValidationError(
            clientNameAndBinary.contractName,
            matchingArtifact,
            "The byte code on the network does not match we stored during the last deployment.")
        }
      }
      else
      {
        // Could not find a matching artifact for the current client snapshot image.
        //  Set the error flag and add an error message for this.
        validationResults.isError = true;

        validationResults.addValidationError(
          clientNameAndBinary.contractName,
          artifact,
          "Unable to find a network byte code snapshot in our archive for contract: " + clientNameAndBinary.contractName);
      }
    });
  },
  
 /**
   * ROS: Create a promise that will validate the stored network
   * byte code snap shot for each contract that is part of this
   * debugging session against the current byte code running
   * on the target network.
   *
   * @param {Object} options - a session environment options object.
   * @param {Array} artifacts - An array of JSON artifact objects.
   *
   * @return {Object} - Returns a custom object with two fields:
   *  isError - Boolean TRUE if the validation failed, FALSE if
   *    all checks succeeded.
   *  aryErrorM
   */
  validateBytecode: function(options, artifacts)
  {
    // ROS: Create a promise that will validate the stored network
    //  byte code snapshot for each contract that is part of this
    //  debugging session against the current byte code running
    //  on the target network.  Return a ContractValidationResults
    //  object as a result of running the validation tests.
    return new Promise(function(accept, reject){
      let networkId = options.network_id;
      let validationResults = new DebugUtils.ContractValidationResults();
    
      // let web3 = new Web3(config.provider);
      let web3Intf = new Web3(options.provider);
    
      
      // Canonicalize the contract name and address fields to an array of just those
      //  field pairs because that is what retrieveNetworkBytecodeAll() expects.
      let aryContractNameAndAddress = DebugUtils.artifactsToNameAndAddress(options.network_id, artifacts);
      
      // Filter out all entries with NULL deployment address for the
      //  network ID for the current session.  We assume those are
      //  for abstract/inherited contracts and those do not get
      //  deployed.
      let aryCleanedContractNameAndAddress =
        _.filter(aryContractNameAndAddress, function(nameAndAddress) {
          return nameAndAddress.address != null;
        });

      // Empty result set?
      if (!aryContractNameAndAddress || aryContractNameAndAddress.length < 1)
      {
        // If we have an empty result set, then we assume that we couldn't find any
        //  stored snapshots.  This is a problem since we can't validate the deployment
        //  byte code archives against the current byte code on the network.
        validationResults.isError = true;
        validationResults.overallResultsMessage =
          "Unable to find any saved network byte code snapshots for the current debugging session.\n "
            + "Please try migrating with the --reset option and trying again.  Aborting debug session.\n";
            
        // We still accept the validation results so we can show a report to the error.
        //  The caller of this method can inspect the isError property of the validationResults
        //  object and decide to do from there.
        accept(validationResults);
      }
      else
      {
        // Get all the network byte code snapshots.
        DebugUtils.retrieveNetworkBytecodeAll(web3Intf, options.logger, aryCleanedContractNameAndAddress)
        .then(function(aryClientNetworkBinaries) {
          // Everything is in place now for us to do the contract byte code image comparisons.
          DebugUtils._doTheValidation(networkId, aryClientNetworkBinaries, artifacts, validationResults);

          // Provide an overall message for the test results.
          if (validationResults.isError)
            validationResults.overallResultsMessage = "Errors found during contract byte code validation.  Please see the details provided below.";
          else
            validationResults.overallResultsMessage = "All validation tests passed!";

          // Accept the validation results, pass or fail, and let the caller use
          //  the isError property of the validation results object to decide what
          //  to do.
          accept(validationResults);
        });
      }
    });
  },
	
  /**
   * Helper function to take a collection of contracts where each
   *  contract is stored as a property whose name is the contract's
   *  name and convert it to a simple array.
   *
   * @param {Object} contracts A collection of contracts as property
   *  names of a larger object.
   *
   * @return {Array} - A simple array of the contracts.
   */
  objectPropertiesToArray: function(contracts)
  {
    let aryRet = new Array();
    
    Object.keys(contracts).forEach(function(key) { aryRet.push(contracts[key]); });
    
    return aryRet;
  },
	
  /**
   * Given an array of Truffle contracts, returns the element with the
   *  given contract name.
   *
   * @param {String} contractName - The name of the desired contract.
   * @param {Array} truffleContracts - An array of Truffle contracts.
   *
   * @return {TruffleContract|null} - Returns the Truffle contract with
   *  the desired name or "undefined" if not found.
   */
  selectTruffleContractFromArray: function(contractName, truffleContracts)
  {
    return _.find(truffleContracts, function(contract) { return contract.contract_name == contractName });
  },
	
  /**
   * Given a Truffle contract, select the network element with the given network ID.
   *
   * @param {String} networkId - The desired network ID.
   * @param {Object} truffleContract - A Truffle contract.
   *
   * @return {Object} - Returns the network entry in the Truffle contracts
   *  networks section that bears the given ID, otherwise "undefined" is
   *  returned.
   */
  selectNetworkEntryFromTruffleContract: function(networkId, truffleContract)
  {
    return truffleContract.networks[networkId];
  },
	
  /**
   * Given an artifact, select the network entry from a JSON artifact object.
   *
   * @param {String} networkId - The desired network ID.
   *
   * @return {Object} - Returns the network entry in the artifact
   *  networks section that bears the given ID, otherwise "undefined" is
   *  returned.
   */
  selectNetworkEntryFromArtifact: function(networkId, artifact)
  {
    return artifact.networks[networkId];
  },
	
  /**
   * Given an array of Truffle contracts, extract out the contract name and
   *  deployment address to create an array of those field pairs.
   *
   * @param {Array} truffleContracts - An array of Truffle contracts.
   *
   * @return {Array} - Returns an array of contract name and address pair objects.
   */
  truffleContractsToNameAndAddress: function(truffleContracts)
  {
    let aryContractNameAndAddress = new Array();
    
    _.forEach(truffleContracts,
      function(contract)
      {
        let contractNameAndAddress = new DebugUtils.ContractNameAndAddress();
        
        contractNameAndAddress.contractName = contract.contract_name;
        contractNameAndAddress.address = contract.address;
        
        aryContractNameAndAddress.push(contractNameAndAddress);
      }
    );
    
    return aryContractNameAndAddress;
  },
  
  /**
   * Given an array of JSON artifacts and a network ID, extract out
   *  the contract name and deployment address for the given network
   *  ID to create an array of those field pairs.
   *
   * @param {String} networkId - The desired network ID.
   * @param {Array} artifacts - An array of JSON artifacts.
   *
   * @return {Array} - Returns an array of contract name and address pair objects.
   */
  artifactsToNameAndAddress: function(networkId, artifacts)
  {
    let aryContractNameAndAddress = new Array();
    
    _.forEach(artifacts,
      function(artifact)
      {
        let nameAndAddress = new DebugUtils.ContractNameAndAddress();
        
        nameAndAddress.contractName = artifact.contractName;
        
        let networkEntry = DebugUtils.selectNetworkEntryFromArtifact(networkId, artifact);
        
        // If the contract deployment address is undefined or NULL, then we assume
        //  it's because it belongs to a contract that is an abstract/inherited class
        //  to one of the contracts actually deployed in this session.
        if (networkEntry && networkEntry.address)
          nameAndAddress.address = networkEntry.address;
        else
          // Assign NULL so we know that no contract deployment address was found.
          nameAndAddress.address = null;
        
        aryContractNameAndAddress.push(nameAndAddress);
      }
    );
    
    return aryContractNameAndAddress;
  },
  
  /**
   * Given an array of JSON artifacts and a network ID, extract out
   *  the contract name and deployment binary for the given network
   *  ID to create an array of those field pairs.
   *
   * @param {String} networkId - The desired network ID.
   * @param {Array} artifacts - An array of JSON artifacts.
   *
   * @return {Array} - Returns an array of contract name and binary pair objects.
   */
  artifactsToNameAndBinary: function(networkId, artifacts)
  {
    let aryContractNameAndBinary = new Array();
    
    _.forEach(artifacts,
      function(artifact)
      {
        let nameAndBinary = new DebugUtils.ContractNameAndBinary();
        
        nameAndBinary.contractName = artifact.contractName;
        
        let networkEntry = DebugUtils.selectNetworkEntryFromArtifact(networkId, artifact);
        
        // If the contract deployment binary is undefined or NULL, then we assume
        //  it's because it belongs to a contract that is an abstract/inherited class
        //  to one of the contracts actually deployed in this session.
        if (networkEntry && networkEntry.networkBytecode)
          nameAndBinary.networkBytecode = networkEntry.networkBytecode;
        else
          // Assign NULL so we know that no contract deployment binary was found.
          nameAndBinary.networkBytecode = null;
        
        aryContractNameAndBinary.push(nameAndBinary);
      }
    );
    
    return aryContractNameAndBinary;
  }
  
};

module.exports = DebugUtils;
