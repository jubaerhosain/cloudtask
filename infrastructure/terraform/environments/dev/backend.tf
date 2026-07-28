# State lives in the bucket created by ../../bootstrap. Account-specific
# values (bucket name, deploy role ARN) stay out of git in the gitignored
# backend.hcl — copy backend.hcl.example, fill it in, then initialize with:
#   terraform init -backend-config=backend.hcl
terraform {
  backend "s3" {
    key          = "cloudtask/dev/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
