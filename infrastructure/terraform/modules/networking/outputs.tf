output "vpc_id" {
  description = "VPC id"
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC CIDR block"
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet ids (ALB, NAT)"
  value       = aws_subnet.public[*].id
}

output "private_app_subnet_ids" {
  description = "Private app subnet ids (ECS tasks)"
  value       = aws_subnet.private_app[*].id
}

output "private_data_subnet_ids" {
  description = "Private data subnet ids (RDS, ElastiCache)"
  value       = aws_subnet.private_data[*].id
}

output "nat_gateway_id" {
  description = "NAT gateway id (null when disabled)"
  value       = var.enable_nat_gateway ? aws_nat_gateway.this[0].id : null
}
