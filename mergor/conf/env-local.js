module.exports = {
  logsLimit: 500000,
  cronH: 17, //+6 hours
  cronM: 45,
  cronInterval: 60000,
  services: {
    elb_app: {
      name: 'elb_app',
      profile: 'logs_ingestor',
      bucket: 'aws-logs',
      archive_path: 'archive/elb/aws-portal/',
      src: '/opt/logs/aws/elb/portal/',
      dst: '/opt/logs/archive/aws/elb/portal/',
      log_type: 'elb'
    },
    s3_bucket: {
      name: 's3_bucket',
      profile: 'logs_ingestor',
      bucket: 'aws-logs',
      archive_path: 'archive/s3/aws-datadocs/',
      src: '/opt/logs/aws/s3/datadocs/',
      dst: '/opt/logs/archive/aws/s3/datadocs/',
      log_type: 's3'
    }
  }
};