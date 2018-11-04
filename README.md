# aws-monitoring

AWS ELB and S3 detailed logs sent to Elastic Stack for analysis.


Setup for Ansible:

```
nano ~/.ssh/config.aws-monitoring
  Host *.ec2.internal
    User ubuntu
    IdentityFile /home/dml/.ssh/aws-monitoring.pem
    ProxyCommand ssh aws-c1 -W %h:%p
  Host aws-c1
    User ubuntu
    IdentityFile /home/dml/.ssh/aws-monitoring.pem
    HostName 54.236.173.124

ln -s ~/.ssh/config.aws-monitoring ~/.ssh/config
```