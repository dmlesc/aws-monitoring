'use strict';
var log = require('./log');
process.on('uncaughtException', (err) => { log('uncaught', err, err.stack); });

const conf = require('./conf/' + process.argv[2]);


const fs = require('fs');
const elasticsearch = require('elasticsearch');

const elastic = new elasticsearch.Client({
  host: conf.elasticsearch_host
  //, log: 'trace'
});

const howmany = 5000;

var m = require('./metrics');
m();
m.register('bulk_es_ms_total');
m.register('files_processed_total');
m.register('logs_queue_length');


var p_elb_app = create_AWS_SDK_conf_objs(conf.elb_app, parseLogsELB);
var p_s3_bucket = create_AWS_SDK_conf_objs(conf.s3_bucket, parseLogsS3);


function create_AWS_SDK_conf_objs(service, parser) {
  const AWS = require('aws-sdk');
  AWS.config.update({region: 'us-east-1'});
  const credentials = new AWS.SharedIniFileCredentials({profile: service.profile});
  AWS.config.credentials = credentials;
  const sqs = new AWS.SQS({apiVersion: '2012-11-05'});
  const s3 = new AWS.S3({apiVersion: '2006-03-01'});
  
  var p = {
    sqs_url: service.q_url,
    sqs_obj: sqs,
    s3_obj: s3,
    s3_bucket: service.bucket,
    save_dst: service.save_dst,
    index_name: service.index_name,
    logs_queue: [],
    processing: false,
    parser: parser
  };

  return p;
}


function getQueueAttributes(p) {
  var params = {
    QueueUrl: p.sqs_url,
    AttributeNames: ['ApproximateNumberOfMessages']
  };

  p.sqs_obj.getQueueAttributes(params, (err, data) => {
    if (err) { log('Error - sqs.getQueueAttributes', err, err.stack); }
    else { //log('sqs data', data);
      var numMess = data.Attributes.ApproximateNumberOfMessages;

      if (numMess > 0) {
        log(p.index_name + ' numMess', numMess);
        receiveMessages(p);
      }
      else {
        log(p.index_name, 'no messages on queue');
        setTimeout(getQueueAttributes, 60000, p);
      }
    }
  });
}
function receiveMessages(p) {
  var params = {
    QueueUrl: p.sqs_url,
    MaxNumberOfMessages: 10,
    VisibilityTimeout: 60,
    WaitTimeSeconds: 0
  };

  var keys = [];
  var objs = [];
  
  p.sqs_obj.receiveMessage(params, (err, data) => {
    if (err) { log('Error - sqs.receiveMessage', err, err.stack); }
    else { //log('sqs data', data);
      if (data.Messages) {
        for (var i=0; i<data.Messages.length; i++) {
          var message = data.Messages[i];
          var body = JSON.parse(message.Body);

          if (body.Records) {
            var key = body.Records[0].s3.object.key;
            //log('key', key);

            if (keys.indexOf(key) == -1) {
              keys.push(key);
              objs.push({ key: key, handle: message.ReceiptHandle });
            }
          }
          else {
            log(p.index_name + ' sqs message deleted:', message);
            deleteMessage(p, message.ReceiptHandle);
          }
        }

        getObjs(p, objs);
      }
      else {
        log(p.index_name, 'no messages on queue really');
        setTimeout(getQueueAttributes, 60000, p);
      }
    }
  });
}
function getObjs(p, objs) {
  var obj = objs.shift();
  var key = obj.key;

  p.s3_obj.getObject({ Bucket: p.s3_bucket, Key: key }, (err, data) => {
    if (err) { log('Error - s3.getObject', err, err.stack);
      log('key', key);
      deleteMessage(p, obj.handle);
    }
    else { //log('s3 data', data);
      m.inc('files_processed_total');

      var file = key.split('/').reverse()[0];

      saveObj(p, p.save_dst + file, data.Body, key);
      deleteMessage(p, obj.handle);

      pushLogsToQueue(p, data.Body.toString().split('\n'));
    }

    if (objs.length) {
      getObjs(p, objs);
    }
    else {
      //log(p.index_name + ' getObjs', 'all keys in batch downloaded');
      getQueueAttributes(p);
    }
  });
}
function saveObj(p, path, body, key) {
  fs.writeFile(path, body, (err) => {
    if (err) { log('Error - fs.writeFile', err); }
    else {
      //log('Saved', '...' + path.slice(-30));
      deleteObj(p, key);
    }
  });
}
function deleteObj(p, key) {
  p.s3_obj.deleteObject({ Bucket: p.s3_bucket, Key: key }, (err, data) => {
    if (err) { log('Error - s3.deleteObject', err, err.stack); }
    else { //log('s3 data', data);
      //log('Deleted', '...' + key.slice(-30));
    }
  });
}
function deleteMessage(p, handle) {
  p.sqs_obj.deleteMessage({ QueueUrl: p.sqs_url, ReceiptHandle: handle }, (err, data) => {
    if (err) { log('Error - sqs.deleteMessage', err, err.stack); }
    else { //log('sqs data', data);
      //log('deleteMessage', 'message deleted');
    }
  });
}
function pushLogsToQueue(p, logs) {
  //log('logs.length', logs.length);
  for (var i=0; i<logs.length; i++) {
    var line = logs[i];

    if (line != '') {
      p.logs_queue.push(line);
    }
  }

  if (!p.processing && p.logs_queue.length) {
    p.processing = true;
    p.parser(p, p.logs_queue.splice(0, howmany));
  }
  else {
    log(p.index_name, 'already processing');
  }
}
function parseLogsELB(p, batch) {
  var bulk = [];

  for (var i=0; i < batch.length; i++) {
    var line = batch[i].split(' ');

    var timestamp = line[0];
    var elb = line[1];
    var client = line[2];
    var backend = line[3];

    var client_host = client.split(':')[0];
    var client_port = client.split(':')[1];
    var backend_host = backend.split(':')[0];
    var backend_port = backend.split(':')[1];
    
    var request_processing_time = line[4];
    var backend_processing_time = line[5];
    var response_processing_time = line[6];
    var elb_status_code = line[7];
    var backend_status_code = line[8];
    var received_bytes = line[9];
    var sent_bytes = line[10];

    var request = (line[11] + ' ' + line[12] + ' ' + line[13]).replace(/"/g, '');
    var req_splt = request.split(' ');
    var req_method = req_splt[0];
    var req_path = req_splt[1];
    var req_http_version = req_splt[2];

    var user_agent = line.slice(14, line.length - 2).join(' ').replace(/"/g, '');
    var ssl_cipher = line[line.length - 2];
    var ssl_protocol = line[line.length - 1];

    var doc = {};

    doc.timestamp = timestamp;
    doc.client_host = client_host;
    doc.backend_host = backend_host;
    doc.request_time = sec2ms(request_processing_time);
    doc.backend_time = sec2ms(backend_processing_time);
    doc.response_time = sec2ms(response_processing_time);
    doc.elb_status_code = elb_status_code;
    doc.backend_status_code = backend_status_code;
    doc.received_bytes = received_bytes;
    doc.sent_bytes = sent_bytes;
    doc.req_method = req_method;
    doc.req_path = req_path;
    doc.user_agent = user_agent;

    var ts_splt = timestamp.split('-');
    var index = p.index_name + ts_splt[0] + '.' + ts_splt[1];

    var action = {};
    action.index = { _index: index, _type: 'doc'};

    bulk.push(action);
    bulk.push(doc);

    //log(doc);
  }

  elasticBulk(p, bulk);
}
function parseLogsS3(p, batch) {
  var bulk = [];

  for (var i=0; i < batch.length; i++) {
    var line = batch[i].split(' ');
    
    var bucket_owner = line[0];
    var bucket = line[1];
    var time = line[2] + ' ' + line[3];
    var remote_ip = line[4];
    var requester = line[5];
    var request_id = line[6];
    var operation = line[7];
    var key = line[8];
    var request_uri = line[9] + ' ' + line[10] + ' ' + line[11];
    var http_status = line[12];
    var error_code = line[13];
    var bytes_sent = line[14];
    var object_size = line[15];
    var total_time = line[16]; //ms
    var turn_around_time = line[17]; //ms
    var referrer = line[18];
    var ua_spaces = (line.length - 1) - 19;
    var user_agent = '';
    for (var j=0; j<ua_spaces; j++) {
      user_agent += line[19 + j] + ' ';
    }
    user_agent = user_agent.trim();
    var version_id = line[line.length -1];

    var t = time.slice(1, 21).split(':');
    var d = new Date(t[0]);
    d.setUTCHours(t[1]);
    d.setUTCMinutes(t[2]);
    d.setUTCSeconds(t[3]);
    var timestamp = d.toJSON();

    if (bytes_sent == '-') {
      bytes_sent = 0;
    }
    if (object_size == '-') {
      object_size = 0;
    }
    if (turn_around_time == '-') {
      turn_around_time = 0;
    }
    var doc = {};

    doc.timestamp = timestamp;
    doc.bucket = bucket;
    doc.remote_ip = remote_ip;
    doc.operation = operation;
    doc.key = key;
    doc.http_status = http_status;
    doc.error_code = error_code;
    doc.bytes_sent = bytes_sent;
    doc.object_size = object_size;
    doc.total_time = total_time;
    doc.turn_around_time = turn_around_time;
    doc.referrer = referrer;
    doc.user_agent = user_agent;


    var key_splt = key.split('/');
    if (key_splt[0] == 'online') {
      var folder = key_splt[1];
      doc.online_folder = folder;

      if (folder == 'saves') {
        doc.student_id = key_splt[2];
      }
    }


    var ts_splt = timestamp.split('-');
    var index = p.index_name + ts_splt[0] + '.' + ts_splt[1];

    var action = {};
    action.index = { _index: index, _type: 'doc'};

    bulk.push(action);
    bulk.push(doc);

    //console.log(doc);
  }

  elasticBulk(p, bulk);
}
function sec2ms(str) {
  //log('str:', str);
  var ms = 0;

  if (str != '-1') {
    var str = str.split('.'); 
    var seconds = Number(str[0]);
    var decimal = 0;

    if (str[1]) {
      decimal = str[1].split('');
      decimal.splice(3, 0, '.');
      decimal = parseFloat(decimal.join(''));
    }

    var ms = (seconds * 1000) + decimal;
  }

  return ms;
}
function elasticBulk(p, bulk) {
  m.startTime('bulk_es_ms_total');
  elastic.bulk({ body: bulk }, (err, res) => {
    m.endTime('bulk_es_ms_total');
    if (err) {
      log('Error - elastic.bulk', err, err.stack);
      log('Error - elastic.bulk', 'retrying in 10 seconds...');
      
      setTimeout(elasticBulk, 10000, p, bulk);
    }
    else { //log('es', res); console.log(res.items[0].index);
      //m.set('logs_queue_length', p_s3_old.logs_queue.length + p_elb_app.logs_queue.length);
      log(p.index_name + ' inserted', bulk.length/2);

      if (p.logs_queue.length > 0) {
        p.parser(p, p.logs_queue.splice(0, howmany));
      }
      else {
        //log('elasticBulk', 'nothing in queue');
        p.processing = false;
      }
    }
  });
}


//getQueueAttributes(p_s3_old);
getQueueAttributes(p_elb_app);
getQueueAttributes(p_s3_bucket);