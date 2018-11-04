module.exports = {
  elasticsearch_host: 'http://esproxy0:9200',
  elb_app: {
    profile: 'logs_ingestor',
    q_url: 'https://sqs.us-east-1.amazonaws.com/123456/elb-app-log',
    bucket: 'aws-logs',
    save_dst: '/opt/logs/aws/elb/app/',
    index_name: 'aws-elb-app-'
  },
  s3_bucket: {
    profile: 'logs_ingestor',
    q_url: 'https://sqs.us-east-1.amazonaws.com/123456/s3-bucket-log',
    bucket: 'aws-logs',
    save_dst: '/opt/logs/aws/s3/bucket/',
    index_name: 'aws-s3-bucket-'
  }
};