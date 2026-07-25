# State lives in the bucket created by ../../bootstrap. Bucket names are
# globally unique (account-id suffix), so set yours here after running
# bootstrap, or pass it via:
#   terraform init -backend-config="bucket=cloudtask-terraform-state-<account_id>"
terraform {
  backend "s3" {
    bucket         = "REPLACE_WITH_BOOTSTRAP_STATE_BUCKET"
    key            = "cloudtask/dev/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "cloudtask-terraform-locks"
  }
}
