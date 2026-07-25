# Repo names <name_prefix>-{api,worker,web} are a hard contract with
# .github/workflows/release.yml — it pushes to exactly these names.

resource "aws_ecr_repository" "this" {
  for_each = var.repository_names

  name                 = "${var.name_prefix}-${each.key}"
  image_tag_mutability = "IMMUTABLE"

  # Lab environment: allow destroy with images still present.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each = aws_ecr_repository.this

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only the 10 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}
