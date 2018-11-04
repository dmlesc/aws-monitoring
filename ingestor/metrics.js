'use strict';
var log = require('./log');
process.on('uncaughtException', (err) => { log(err); });

var port = 12345;
var ip = '0.0.0.0';
const http = require('http');
var register = {};
const prefix = 'ingestor_';

var metrics = () => {  
  var start_cpu_usage = process.cpuUsage();
  var cpu_usage_user = 0;
  var cpu_usage_system = 0;
  
  const server = http.createServer((req, res) => {
    //log(new Date().toJSON() + ' - ' + req.url);
    var code = 200;
    var data = '';
  
    if (req.url == '/metrics') {
      const uptime = process.uptime();
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage(start_cpu_usage);
      start_cpu_usage = process.cpuUsage();
      cpu_usage_user += cpu.user;
      cpu_usage_system += cpu.system;
  
      data += prefix + 'process_uptime ' + uptime + '\n'; 
      data += prefix + 'process_memory{type="rss"} ' + mem.rss + '\n'; 
      data += prefix + 'process_memory{type="heapUsed"} ' + mem.heapUsed + '\n'; 
      data += prefix + 'process_memory{type="heapTotal"} ' + mem.heapTotal + '\n'; 
      data += prefix + 'process_cpu{type="user"} ' + cpu.user + '\n'; 
      data += prefix + 'process_cpu{type="system"} ' + cpu.system + '\n'; 
      data += prefix + 'process_cpu_total{type="user"} ' + cpu_usage_user + '\n'; 
      data += prefix + 'process_cpu_total{type="system"} ' + cpu_usage_system + '\n'; 

      Object.keys(register).forEach( (metric) => {
        data += prefix + metric + ' ' + register[metric]['value'] + '\n';
      });
    }
    else {
      code = 404;
      data = 'not found';
    }

    res.writeHead(code, { 'Content-Type': 'text/plain' });
    res.end(data);
  });
  
  server.listen(port, ip);
  log('metrics', 'ready to serve metrics');
}

metrics.register = (name) => {
  register[name] = {start:0, value:0};
}

metrics.startTime = (name) => {
  register[name]['start'] = process.hrtime();
}

metrics.endTime = (name) => {
  var diff = process.hrtime(register[name]['start']);
  var ms = Math.round(diff[0] * 1000 + diff[1] / 1000000);
  register[name]['value'] += ms;
}

metrics.set = (name, value) => {
  register[name]['value'] = value;
}

metrics.inc = (name) => {
  var value = register[name]['value'];
  value++;
  register[name]['value'] = value;
}
module.exports = metrics;