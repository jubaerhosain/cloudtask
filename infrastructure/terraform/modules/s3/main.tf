# Private exports bucket. Downloads go through API-generated presigned URLs,
# so public access stays fully blocked.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "exports" {
  # Account id suffix for global uniqueness.
  bucket = "${var.name_prefix}-exports-${data.aws_caller_identity.current.account_id}"

  # Lab environment: allow destroy with objects present.
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "exports" {
  bucket = aws_s3_bucket.exports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    id     = "expire-exports"
    status = "Enabled"

    filter {}

    expiration {
      days = var.expiry_days
    }
  }
}
