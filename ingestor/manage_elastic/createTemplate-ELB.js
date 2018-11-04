'use strict';

const env = process.argv[2];
const conf = require('../conf/' + env);

const elasticsearch = require('elasticsearch');
const elastic = new elasticsearch.Client({
  host: conf.elasticsearch_host
  //, log: 'trace'
});

var params = {
  name: 'aws-elb',
  //timeout: '10m',
  body: {
    template: 'aws-elb-*',
    settings: {
      number_of_shards: 2,
      number_of_replicas: 1
    },
    mappings: {
      doc: {
        properties: {
          timestamp: { type: 'date', format: 'strict_date_optional_time' },
          client_host: { type : 'keyword' },
          backend_host: { type : 'keyword' },
          request_time: { type : 'float' },
          backend_time: { type : 'float' },
          response_time: { type : 'float' },
          elb_status_code: { type: 'keyword' },
          backend_status_code: { type : 'keyword' },
          received_bytes: { type: 'integer' },
          sent_bytes: { type: 'integer' },
          req_method: { type: 'keyword' },
          req_path: { type: 'text' },
          user_agent: { type: 'text' }    
        }
      }
    }
  }
};


elastic.indices.putTemplate(params, (err, res) => {
  if (err)
    console.log(err);
  else
    console.log(res);
});

process.on('uncaughtException', (err) => {
  console.log(err);
});