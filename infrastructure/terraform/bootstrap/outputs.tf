output "state_bucket_name" {
  description = "S3 bucket holding Terraform state for environments"
  value       = aws_s3_bucket.terraform_state.bucket
}
