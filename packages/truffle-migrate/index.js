var fs = require("fs");
var dir = require("node-dir");
var path = require("path");
var ResolverIntercept = require("./resolverintercept");
var Require = require("truffle-require");
var async = require("async");
var Web3 = require("web3");
var expect = require("truffle-expect");
var Deployer = require("truffle-deployer");

function Migration(file) {
  this.file = path.resolve(file);
  this.number = parseInt(path.basename(file));
};

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
  function getNetworkBytecode_promise(web3Intf, logger, address) {

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
  };
  
  /**
   * getAndStoreNetworkBytecode_promise - Return a promise that gets the
   *  deployed code for a contract from the current network, and then stores
   *  the returned byte code directly into the contract.
   *
   * @param  {Object} web3Intf - A web3 interface for us to use
   * @param  {Object} logger - A logging provider.
   * @param  {Object} contract - A Truffle contract.
   *
   * @return {Promise}
   */
  function getAndStoreNetworkBytecode_promise(web3Intf, logger, contract)
  {
    logger.log("Getting network byte code and storing it for contract address: %s", contract.address);
    
    return getNetworkBytecode_promise(web3Intf, logger, contract.address)
      .then(function(bytecode)
      {
        contract.network.networkBytecode = bytecode;
        logger.log("Successfully stored the network for contract address: %s", contract.address);
      });
  }

/**
 * This function returns a promise that iterates the Truffle contracts
 *  passed to us and retrieves the actual byte code for each one from
 *  the current network using the web3 interface.
 *
 * @param  {Object} web3Intf - A web3 interface for us to use
 * @param  {Object} logger - A logging provider.
 * @param  {Array} contracts - An array of Truffle contracts.
 */
function retrieveNetworkBytecodeAll_promise(web3Intf, logger, contracts)
{
  logger.log("Retrieving network byte code for " + contracts.length + " contracts.");
  
  // Build an array of promises that will get the network byte code
  //  for each contract in the contracts array and store the
  //  returned byte code directly into the contract.
  let aryPromises = new Array;
  
  for (let ndx = 0; ndx < contracts.length; ndx++)
  {
    // Get the byte code for the specified contract.
    aryPromises.push(getAndStoreNetworkBytecode_promise(web3Intf, logger, contracts[ndx]));
  }
  
  // Return a promise that waits for all the promises to complete.
  return Promise.all(aryPromises);

/*
  return new Promise(function(accept, reject)
  {
    try{
    }
    catch(err)
    {
        // Convert the error into a promise rejection.
        reject(err);
    };
  });
*/
}

Migration.prototype.run = function(options, callback) {
  var self = this;
  var logger = options.logger;

  var web3 = new Web3();
  web3.setProvider(options.provider);
  
  // Make it available to callbacks.
  self.web3Intf = web3;

  logger.log("Running migration: " + path.relative(options.migrations_directory, this.file));

  var resolver = new ResolverIntercept(options.resolver);

  // Initial context.
  var context = {
    web3: web3
  };

  var deployer = new Deployer({
    logger: {
      log: function(msg) {
        logger.log("  " + msg);
      }
    },
    network: options.network,
    network_id: options.network_id,
    provider: options.provider,
    basePath: path.dirname(this.file)
  });

  var finish = function(err) {
    if (err) return callback(err);
    deployer.start().then(function() {
      if (options.save === false) return;

      var Migrations = resolver.require("./Migrations.sol");

      if (Migrations && Migrations.isDeployed()) {
        logger.log("Saving successful migration to network...");
        return Migrations.deployed().then(function(migrations) {
          return migrations.setCompleted(self.number);
        });
      }
    })
    // ROS: This THEN block fills in the new networkBytecode field for all the
    //  contracts we just deployed.
    .then(function() {
      logger.log("Retrieving network byte code snapshots for each deployed contract...");
      return retrieveNetworkBytecodeAll_promise(self.web3Intf, logger, resolver.contracts());
    })
    .then(function() {
      if (options.save === false) return;
      logger.log("Saving artifacts...");
      return options.artifactor.saveAll(resolver.contracts());
    }).then(function() {
      // Use process.nextTicK() to prevent errors thrown in the callback from triggering the below catch()
      process.nextTick(callback);
    }).catch(function(e) {
      logger.log("Error encountered, bailing. Network state unknown. Review successful transactions manually.");
      callback(e);
    });
  };

  web3.eth.getAccounts(function(err, accounts) {
    if (err) return callback(err);

    Require.file({
      file: self.file,
      context: context,
      resolver: resolver,
      args: [deployer],
    }, function(err, fn) {
      if (!fn || !fn.length || fn.length == 0) {
        return callback(new Error("Migration " + self.file + " invalid or does not take any parameters"));
      }
      fn(deployer, options.network, accounts);
      finish();
    });
  });
};

var Migrate = {
  Migration: Migration,

  assemble: function(options, callback) {
    dir.files(options.migrations_directory, function(err, files) {
      if (err) return callback(err);

      options.allowed_extensions = options.allowed_extensions || /^\.(js|es6?)$/;

      var migrations = files.filter(function(file) {
        return isNaN(parseInt(path.basename(file))) == false;
      }).filter(function(file) {
        return path.extname(file).match(options.allowed_extensions) != null;
      }).map(function(file) {
        return new Migration(file, options.network);
      });

      // Make sure to sort the prefixes as numbers and not strings.
      migrations = migrations.sort(function(a, b) {
        if (a.number > b.number) {
          return 1;
        } else if (a.number < b.number) {
          return -1;
        }
        return 0;
      });

      callback(null, migrations);
    });
  },

  run: function(options, callback) {
    var self = this;

    expect.options(options, [
      "working_directory",
      "migrations_directory",
      "contracts_build_directory",
      "provider",
      "artifactor",
      "resolver",
      "network",
      "network_id",
      "logger",
      "from", // address doing deployment
    ]);

    if (options.reset == true) {
      return this.runAll(options, callback);
    }

    self.lastCompletedMigration(options, function(err, last_migration) {
      if (err) return callback(err);

      // Don't rerun the last completed migration.
      self.runFrom(last_migration + 1, options, callback);
    });
  },

  runFrom: function(number, options, callback) {
    var self = this;

    this.assemble(options, function(err, migrations) {
      if (err) return callback(err);

      while (migrations.length > 0) {
        if (migrations[0].number >= number) {
          break;
        }

        migrations.shift();
      }

      if (options.to) {
        migrations = migrations.filter(function(migration) {
          return migration.number <= options.to;
        });
      }

      self.runMigrations(migrations, options, callback);
    });
  },

  runAll: function(options, callback) {
    this.runFrom(0, options, callback);
  },

  runMigrations: function(migrations, options, callback) {
    // Perform a shallow clone of the options object
    // so that we can override the provider option without
    // changing the original options object passed in.
    var clone = {};

    Object.keys(options).forEach(function(key) {
      clone[key] = options[key];
    });

    if (options.quiet) {
      clone.logger = {
        log: function() {}
      }
    };

    clone.provider = this.wrapProvider(options.provider, clone.logger);
    clone.resolver = this.wrapResolver(options.resolver, clone.provider);

    async.eachSeries(migrations, function(migration, finished) {
      migration.run(clone, function(err) {
        if (err) return finished(err);
        finished();
      });
    }, callback);
  },

  wrapProvider: function(provider, logger) {
    var printTransaction = function(tx_hash) {
      logger.log("  ... " + tx_hash);
    };

    return {
      send: function(payload) {
        var result = provider.send(payload);

        if (payload.method == "eth_sendTransaction") {
          printTransaction(result.result);
        }

        return result;
      },
      sendAsync: function(payload, callback) {
        provider.sendAsync(payload, function(err, result) {
          if (err) return callback(err);

          if (payload.method == "eth_sendTransaction") {
            printTransaction(result.result);
          }

          callback(err, result);
        });
      }
    };
  },

  wrapResolver: function(resolver, provider) {
    return {
      require: function(import_path, search_path) {
        var abstraction = resolver.require(import_path, search_path);

        abstraction.setProvider(provider);

        return abstraction;
      },
      resolve: resolver.resolve
    }
  },

  lastCompletedMigration: function(options, callback) {
    var Migrations;

    try {
      Migrations = options.resolver.require("Migrations");
    } catch (e) {
      return callback(new Error("Could not find built Migrations contract: " + e.message));
    }

    if (Migrations.isDeployed() == false) {
      return callback(null, 0);
    }

    var migrations = Migrations.deployed();

    Migrations.deployed().then(function(migrations) {
      // Two possible Migrations.sol's (lintable/unlintable)
      return (migrations.last_completed_migration)
        ? migrations.last_completed_migration.call()
        : migrations.lastCompletedMigration.call();

    }).then(function(completed_migration) {
      callback(null, completed_migration.toNumber());
    }).catch(callback);
  },

  needsMigrating: function(options, callback) {
    var self = this;

    if (options.reset == true) {
      return callback(null, true);
    }

    this.lastCompletedMigration(options, function(err, number) {
      if (err) return callback(err);

      self.assemble(options, function(err, migrations) {
        if (err) return callback(err);

        while (migrations.length > 0) {
          if (migrations[0].number >= number) {
            break;
          }

          migrations.shift();
        }

        callback(null, migrations.length > 1);
      });
    });
  }
};

module.exports = Migrate;
