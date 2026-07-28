# This file IS committed — it holds no account-specific values. The AWS account
# ID lives in account.auto.tfvars (gitignored, copy account.auto.tfvars.example),
# which Terraform loads automatically; providers.tf builds the deploy role ARN
# from it. The account ID also has to be repeated in backend.hcl, since backend
# blocks cannot reference variables.

aws_region   = "ap-south-1"
project_name = "cloudtask"
environment  = "dev"
owner        = "jubaer"

# Required for tasks to reach ECR/Secrets Manager/SQS/S3 from private subnets.
enable_nat_gateway = true

# Set false if the AWS account already has a GitHub OIDC provider.
create_oidc_provider = true

# Leave at "bootstrap": services start at desired_count = 0, so the placeholder
# image is never pulled. CI registers real git-SHA revisions and scales up on
# the first release run.
api_image_tag    = "bootstrap"
worker_image_tag = "bootstrap"
web_image_tag    = "bootstrap"
desired_count    = 0

database_instance_class = "db.t4g.micro"
redis_node_type         = "cache.t4g.micro"
