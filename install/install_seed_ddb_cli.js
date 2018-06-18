var co = require("co");
var chalk = require('chalk');
const default_region = process.env.AWS_DEFAULT_REGION;
const posts_table = process.env.DYNAMODB_TABLE_POSTS;
const objects_table = process.env.DYNAMODB_TABLE_OBJECTS;

co(function*() {

  var AWS = require('aws-sdk');
  AWS.config.update({
    region: default_region
  });
  var dynamodb = new AWS.DynamoDB({
    apiVersion: '2012-08-10'
  });

  console.log();
  console.log(chalk.cyan("Populating DynamoDB tables with data"));

  var putToDB = function(table_name, data, err) {
    if (err) {
      console.log(chalk.red(err));
      console.log(err);
      reject();
    } else {
      return fn = co.wrap(function*() {
        for (var i = 0; i < data.length; i++) {
          yield new Promise(function(resolve2, reject2) {
            var db_item = {};
            for (var key in data[i]) {
              var db_key = key.split(" ")[0];
              var db_key_type = key.split(" ")[1].replace(/[()]/g, "");

              db_item[db_key] = {};
              if (db_key === "JSON" || db_key === "categories") {
                //db_item[db_key][db_key_type] = JSON.stringify(data[i][key]);
                db_item[db_key][db_key_type] = data[i][key] + "";
              } else if (db_key_type === "N") {
                db_item[db_key][db_key_type] = data[i][key] + "";
              } else {
                db_item[db_key][db_key_type] = data[i][key];
              }
            }

            var params = {
              Item: db_item,
              TableName: table_name,
              /* required */
              ReturnValues: 'NONE'
            };

            dynamodb.putItem(params, function(err, data) {
              if (err) {
                console.log(chalk.red(err));
                console.log(err.stack);
                reject2();
              } else {
                console.log("An item was added into: " + chalk.green(table_name) + " table");
                resolve2();
              }
            });
          })
        }
      });
    }
  }

  var Converter = require("csvtojson").Converter;
  var converter = new Converter({});

  yield new Promise(function(resolve, reject) {
    dynamodb.scan({
      TableName: objects_table
    }, function(err, data) {
      if (data.Count == 0) {
        var converter = new Converter({});
        converter.fromFile("./install/install_objects.csv", function(err, result) {
          var params = {
            TableName: objects_table
          };
          dynamodb.waitFor('tableExists', params, function(err, data) {
            if (err) {
              console.log(err, err.stack);
            } else {
              putToDB(objects_table, result, err)().then(function() {
                resolve();
              });
            }
          });

        });
      }else{console.log("table "+objects_table+" already have "+data.Count+" items.");resolve();}
    });
  });

  yield new Promise(function(resolve, reject) {
    dynamodb.scan({
      TableName: posts_table
    }, function(err, data) {
      if (data.Count == 0) {
        var converter = new Converter({});
        converter.fromFile("./install/install_posts.csv", function(err, result) {
          var params = {
            TableName: posts_table
          };
          dynamodb.waitFor('tableExists', params, function(err, data) {
            if (err) {
              console.log(err, err.stack);
            } else {
              putToDB(posts_table, result, err)().then(function() {
                resolve();
              });
            }
          });

        });
      }else{console.log("table "+posts_table+" already have "+data.Count+" items.");resolve();}
    });
  });

  process.exit();

}).catch(function(err) {
  console.log(err);
  process.exit();
});
