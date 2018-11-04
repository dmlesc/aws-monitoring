'use strict';

const env = process.argv[2];
const conf = require('../conf/' + env);

var date = process.argv[3];

const elasticsearch = require('elasticsearch');
const elastic = new elasticsearch.Client({
  host: conf.elasticsearch_host
  //, log: 'trace'
});

//var indices = ['*-2016-12-*'];
var indices = ['aws-*'];

elastic.indices.delete({ index: indices }, (err, res) => {
  if (err)
    console.log(err);
  else {
    console.log(res);
  }
});

process.on('uncaughtException', (err) => {
  console.log(err);
});