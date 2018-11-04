'use strict';
const log = require('./log');
process.on('uncaughtException', (err) => { log('uncaught', err, err.stack); });

const conf = require('./conf/' + process.argv[2]);

const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');

var m = require('./metrics');
m();
m.register('save_local_ms_total');
m.register('save_s3_ms_total');
m.register('archives_created_total');

var logsLimit = conf.logsLimit;
var pees = [];

function create_AWS_SDK_conf_objs(service) {
  const AWS = require('aws-sdk');
  AWS.config.update({region: 'us-east-1'});
  const credentials = new AWS.SharedIniFileCredentials({profile: service.profile});
  AWS.config.credentials = credentials;
  const s3 = new AWS.S3({apiVersion: '2006-03-01'});
  
  var p = {
    s3_obj: s3,
    bucket: service.bucket,
    archive_path: service.archive_path,
    name: service.name,
    src: service.src,
    dst: service.dst,
    log_type: service.log_type,
    files: [],
    logs: [],
    files_merged: 0,
    files_deleted: 0,
    files_to_delete: []
  };

  return p;
}


function init() {
  Object.keys(conf.services).forEach((service) => {
    var p = create_AWS_SDK_conf_objs(conf.services[service]);
    pees.push(p);
  });

  ctrl(pees.shift());
}

function ctrl(p) {
  p.files = fs.readdirSync(p.src);
  log(p.name + ' #files', p.files.length);

  if (p.files.length) {
    p.files_to_delete = p.files.slice();
    merge(p);
  }
  else if (pees.length) {
    ctrl(pees.shift());
  }
  else {
    log('mergor', 'done merging');
  }
}

function merge(p) {
  var file = p.src + p.files.shift();

  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  rl.on('line', (line) => { 
    if (line != '') {
      p.logs.push(line);
    }
  });
  rl.on('close', () => {
    p.files_merged++;

    if (p.logs.length >= logsLimit) {
      log(p.name, 'logsLimit reached', p.logs.length);
      saveArchiveLocal(p);
    }
    else if (p.files.length) {
      //log(p.name, 'more files to merge');
      merge(p);
    }
    else {
      log(p.name, 'no more files to merge');
      log(p.name, 'logs.length', p.logs.length);
      saveArchiveLocal(p);
      log(p.name, 'files_merged', p.files_merged);
      cleanUp(p);

      if (pees.length) {
        ctrl(pees.shift());
      }
      else {
        log('mergor', 'done merging');
      }
    }
  });
}

function saveArchiveLocal(p) {
  var timestamp = '';
  var first_log = p.logs[0].split(' ');

  if (p.log_type == 'elb') {
    timestamp = first_log[0].replace(/:|\./g, '_');
  }

  if (p.log_type == 's3') {
    var time = first_log[2] + ' ' + first_log[3];
    var t = time.slice(1, 21).split(':');
    var d = new Date(t[0]);
    d.setUTCHours(t[1]);
    d.setUTCMinutes(t[2]);
    d.setUTCSeconds(t[3]);
    timestamp = d.toJSON().replace(/:|\./g, '_');
  }

  var filename = p.dst + p.name + '_' + timestamp + '.gz';

  log(p.name, 'saving archive local...', filename);

  m.startTime('save_local_ms_total');
  fs.writeFileSync(filename, zlib.gzipSync(JSON.stringify(p.logs)));
  m.endTime('save_local_ms_total');

  p.logs = [];
  log(p.name, 'archive saved local', filename);

  saveArchiveS3(p, filename);
}

function saveArchiveS3(p, filename) {
  fs.readFile(filename, (err, data) => {
    if (err) { log('fs.readFile', err, err.stack); }
    else {
      var body = data;
      var key = p.archive_path + filename.split('/').reverse()[0];
      //log('key', key);
    
      var params = {
        Body: body,
        Bucket: p.bucket,
        Key: key
      };

      log(p.name, 'saving archive S3...', filename);

      m.startTime('save_s3_ms_total');
      p.s3_obj.putObject(params, (err, data) => {
        m.endTime('save_s3_ms_total');
        if (err) { log('Error - s3.putObject', err, err.stack); }
        else { //log('s3.putObject', data);
          log(p.name, 'archive saved S3', key);
          deleteArchiveLocal(p, filename);
        }
      });
    }
  });
}

function deleteArchiveLocal(p, filename) {
  fs.unlink(filename, (err) => {
    if (err) { log('Error - fs.unlink', err, err.stack); }
    else {
      log(p.name, 'archive deleted local', filename);
      m.inc('archives_created_total');

      if (p.files.length) {
        log(p.name, 'more files to merge');
        merge(p);
      }
    }
  });
}

function cleanUp(p) {
  var files = p.files_to_delete;
  log(p.name + '#files to delete:', files.length);

  for (var i=0; i<p.files_to_delete.length; i++) {
    fs.unlinkSync(p.src + files[i]);
    p.files_deleted++;
  }

  log(p.name, 'no more files to delete');
  log(p.name, 'files_deleted', p.files_deleted);
}

function cron() {
  var d = new Date();
  //log('time', d.getHours(), d.getMinutes());

  if (conf.cronH === d.getHours() && conf.cronM === d.getMinutes()) {
    log('mergor', 'time to run!!!');
    init();
  }
}

var check = setInterval(cron, conf.cronInterval);