var co = require("co");
var path = require("path");
var fs = require("fs");
var node_s3_client = require('s3');

var isThere = require("is-there");
var chalk = require('chalk');
var _ = require('lodash');

var MemoryFS = require("memory-fs");
var webpack = require("webpack");
var pass_generator = require('generate-password');
var uuid = require('uuid');


var Mocha = require('mocha');

var lambda_api_mappings = require('./install/install_Lambda_API_Gateway_mappings.json');

var api_gateway_definitions = require('./install/install_API_Gateway_definitions.json');

var zip = require("node-zip");

co(function*(){
  var config = require('./install_config.js');

	var AWS = require('aws-sdk');
	AWS.config.loadFromPath(config.credentials_path);
	var apigateway = new AWS.APIGateway({apiVersion: '2015-07-09'});
  var iam = new AWS.IAM({apiVersion: '2010-05-08'});
  var lambda = new AWS.Lambda({apiVersion: '2015-03-31'});
  console.log();
	console.log(chalk.cyan("creating IAM role"));

	var role_arn = yield new Promise(function(resolve, reject){
		iam.createRole({
		  AssumeRolePolicyDocument: JSON.stringify({
			   "Version" : "2012-10-17",
			   "Statement": [ {
			      "Effect": "Allow",
			      "Principal": {
			         "Service": [ "lambda.amazonaws.com" ]
			      },
			      "Action": [ "sts:AssumeRole" ]
			   } ]
			}),
		  RoleName: config.role_name
		}, function(err, data) {
		  if (err){
		  	if(err.code === "EntityAlreadyExists"){
		  		console.log(chalk.yellow(err));
				iam.getRole({
				  RoleName: config.role_name
				}, function(err, data) {
				  if (err) {
				  	console.log(chalk.red(err));
			  		console.log(err.stack);
			  		reject();
				  }else{
				  	resolve(data.Role.Arn);
				  }
				});
		  	}else{
		  		console.log(chalk.red(err));
		  		console.log(err.stack);
		  		reject();
		  	}
		  }else{
		  	resolve(data.Role.Arn);
		  }
		});
	});
  console.log();
	console.log(chalk.cyan("Uploading Lambda functions & creating API gateway endpoints"));

	function getFiles(srcpath) {
	  return fs.readdirSync(srcpath).filter(function(file) {
	    return !fs.statSync(path.join(srcpath, file)).isDirectory();
	  });
	}

	function getEntries(){
	  var public_files = getFiles(path.join(__dirname, "./lambdas/src/public"))
	    .map(filename => {
	       return {
	       	name: filename,
	       	path: path.join(
		         path.join(__dirname, "./lambdas/src/public"),
		         filename
		    )
	       };
	     })

	  var admin_files = getFiles(path.join(__dirname, "./lambdas/src/admin"))
	    .map(filename => {
	       return {
	       	name: filename,
	       	path: path.join(
		         path.join(__dirname, "./lambdas/src/admin"),
		         filename
		    )
	       };
	     })
	  return public_files.concat(admin_files);
	}


	var entries = getEntries();
	for(var i = 0; i < entries.length; i++){
		yield new Promise(function(resolve, reject){
			var array = fs.readFileSync(entries[i].path).toString().split("\n");
			var first_line = array[0];
			var fn_name_without_prefix = first_line.substring(3).trim();
			var lambda_fn_name = config.lambda_prefix+"_"+fn_name_without_prefix;

			console.log("Creating lambda function: " + chalk.green(lambda_fn_name));

			var mfs = new MemoryFS();
			var compiler = webpack({
			      entry: entries[i].path,
				  output: {
				    path: __dirname,
				    libraryTarget: "commonjs2",
				    filename: "compiled.js"
				  },
				  externals: {
				    "aws-sdk": "aws-sdk"
				  },
				  target: "node",

				  module: {
				    loaders: [{
				        test: /\.json$/,
				        loader: 'json'
				      }]
				  },

			}, function(err, stats) {
			    if (err){
				  	console.log(chalk.red(err));
				  	console.log(err);
				  }
			});
			compiler.outputFileSystem = mfs;

			compiler.run(function(err, stats) {
				var zip = new JSZip();

				zip.file(entries[i].name, mfs.readFileSync(__dirname+"/"+"compiled.js"));
				var data = zip.generate({type:"uint8array", compression: 'deflate'});

			  	var params = {
				  Code: {
				    ZipFile: data
				  },
				  FunctionName: lambda_fn_name,
				  Handler: path.basename(entries[i].name, '.js')+".handler",
				  Role: role_arn,
				  Runtime: "nodejs4.3",
				  //Description: 'STRING_VALUE',
				  MemorySize: 512,
				  Publish: true,
				  Timeout: 10
				};

				lambda.createFunction(params, function(err, data) {
				  if (err){
				  	if(err.code == "ResourceConflictException"){
				  		console.log(chalk.yellow(err));
				  		lambda.getFunction({
						  FunctionName: lambda_fn_name
						}, function(err, data) {
						  if (err) {
						  	console.log(chalk.red(err));
					  		console.log(err.stack);
						  }else{
						  	lambda.addPermission({
							  Action: 'lambda:*',
							  FunctionName: lambda_fn_name,
							  Principal: 'apigateway.amazonaws.com',
							  StatementId: uuid.v4(),
							}, function(err, data) {
							  if (err) {
								console.log(chalk.red(err));
  								console.log(err, err.stack); // an error occurred
  								reject();
							  }else{
							  	//console.log(JSON.parse(data.Statement).Resource);
							  	lambda_api_mappings[fn_name_without_prefix].lambda_arn = JSON.parse(data.Statement).Resource;
						  		resolve();
							  }
							});
						  }
						});
				  	}else{
				  		console.log(chalk.red(err));
				  		console.log(err.stack);
				  	}
				  }else{
					lambda.addPermission({
					  Action: 'lambda:*',
					  FunctionName: lambda_fn_name,
					  Principal: 'apigateway.amazonaws.com',
					  StatementId: uuid.v4(),
					}, function(err, data) {
					  if (err) {
						console.log(chalk.red(err));
  						console.log(err, err.stack); // an error occurred
  						reject();
					  }else{
					  	//console.log(data);
					  	lambda_api_mappings[fn_name_without_prefix].lambda_arn = JSON.parse(data.Statement).Resource;
				  		resolve();
					  }
					});
				  }
				});
			});
		});
	}


	api_gateway_definitions.info.title = config.api_gateway_name;

	for(var key in lambda_api_mappings){
		if(lambda_api_mappings[key].resource.constructor === Array){
			for(var i = 0; i < lambda_api_mappings[key].resource.length; i++){
				if(api_gateway_definitions.paths[lambda_api_mappings[key].resource[i]].post){
					api_gateway_definitions.paths[lambda_api_mappings[key].resource[i]].post["x-amazon-apigateway-integration"].uri = lambda_api_mappings[key].lambda_arn.split(/_/)[1];// "arn:aws:apigateway:"+AWS.config.region+":lambda:path/2015-03-31/functions/"+lambda_api_mappings[key].lambda_arn+"/invocations";
				}
				if(api_gateway_definitions.paths[lambda_api_mappings[key].resource[i]].get){
					api_gateway_definitions.paths[lambda_api_mappings[key].resource[i]].get["x-amazon-apigateway-integration"].uri = lambda_api_mappings[key].lambda_arn.split(/_/)[1];// "arn:aws:apigateway:"+AWS.config.region+":lambda:path/2015-03-31/functions/"+lambda_api_mappings[key].lambda_arn+"/invocations";
				}
			}
		}else{
			if(api_gateway_definitions.paths[lambda_api_mappings[key].resource].post){
				api_gateway_definitions.paths[lambda_api_mappings[key].resource].post["x-amazon-apigateway-integration"].uri = lambda_api_mappings[key].lambda_arn.split(/_/)[1];// "arn:aws:apigateway:"+AWS.config.region+":lambda:path/2015-03-31/functions/"+lambda_api_mappings[key].lambda_arn+"/invocations";
			}
			if(api_gateway_definitions.paths[lambda_api_mappings[key].resource].get){
				api_gateway_definitions.paths[lambda_api_mappings[key].resource].get["x-amazon-apigateway-integration"].uri = lambda_api_mappings[key].lambda_arn.split(/_/)[1];// "arn:aws:apigateway:"+AWS.config.region+":lambda:path/2015-03-31/functions/"+lambda_api_mappings[key].lambda_arn+"/invocations";
			}
		}
	}

  //console.log(api_gateway_definitions);
  var funcs = []
  for(var key in api_gateway_definitions['paths']){
    //console.log("Path: " + key + " lambda: " + api_gateway_definitions['paths'][key][]);
    //console.log("Path: " + key);
    //console.log(api_gateway_definitions['paths'][key]);
    for(var k in api_gateway_definitions['paths'][key]){
      console.log("Path: " + key + " method: " + k);
      func = api_gateway_definitions['paths'][key][k]['x-amazon-apigateway-integration'].uri;
      console.log(func);

      method = {
    	    path: key,
    	    method: k
    	};

      if(!Array.isArray(funcs[func])) { funcs[func] = []; };
      funcs[func].push(method);
    };
  }

  console.log(funcs)

  for(var f in funcs){
console.log('');
console.log('    '+f+':');
console.log('      Type: AWS::Serverless::Function');
console.log('      Properties:');
console.log('        Handler: '+f+'.handler');
console.log('        CodeUri: build/');
console.log('        Policies: AmazonDynamoDBFullAccess');
console.log('        Events:');
count = 0;
for(var e in funcs[f]) {
count = count + 1;
console.log('          '+funcs[f][e]['method'] + '' + count':');
console.log('            Type: Api');
console.log('            Properties:');
console.log('              Path: '+funcs[f][e]['path']);
console.log('              Method: '+funcs[f][e]['method']);
console.log('              RestApiId: !Ref BlogApi');
}
  }



	config.api_gateway_stage_variables.objects_table = config.table_prefix+"_objects";
	config.api_gateway_stage_variables.posts_table = config.table_prefix+"_posts";

	config.api_gateway_stage_variables.articles_bucket = config.bucket_name;

	config.api_gateway_stage_variables.signing_key = pass_generator.generate({
	    length: 20,
	    numbers: true,
	    symbols: false,
	    uppercase: true
	});

	/* config.api_gateway_stage_variables.admin_pass = pass_generator.generate({
	    length: 5,
	    numbers: true,
	    symbols: false,
	    uppercase: true
	}); */

  //console.log(config.api_gateway_stage_variables);

	console.log();


	process.exit();

}).catch(function(err){
	console.log(err);
	process.exit();
});
