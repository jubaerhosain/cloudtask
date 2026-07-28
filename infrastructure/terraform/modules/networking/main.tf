# VPC topology per spec §12: 2 AZs, 6 subnets (public a/b, private-app a/b,
# private-data a/b), IGW, single NAT gateway in public-a. Private-data subnets
# have no route to the internet at all.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  public_cidrs       = ["10.20.0.0/24", "10.20.1.0/24"]
  private_app_cidrs  = ["10.20.10.0/24", "10.20.11.0/24"]
  private_data_cidrs = ["10.20.20.0/24", "10.20.21.0/24"]
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-igw" }
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${var.name_prefix}-public-${substr(local.azs[count.index], -1, 1)}" }
}

resource "aws_subnet" "private_app" {
  count = 2

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_app_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = { Name = "${var.name_prefix}-private-app-${substr(local.azs[count.index], -1, 1)}" }
}

resource "aws_subnet" "private_data" {
  count = 2

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_data_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = { Name = "${var.name_prefix}-private-data-${substr(local.azs[count.index], -1, 1)}" }
}

resource "aws_eip" "nat" {
  count = var.enable_nat_gateway ? 1 : 0

  domain = "vpc"

  tags = { Name = "${var.name_prefix}-nat-eip" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count = var.enable_nat_gateway ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id

  tags = { Name = "${var.name_prefix}-nat" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${var.name_prefix}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private_app" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-private-app-rt" }
}

resource "aws_route" "private_app_nat" {
  count = var.enable_nat_gateway ? 1 : 0

  route_table_id         = aws_route_table.private_app.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

resource "aws_route_table_association" "private_app" {
  count = 2

  subnet_id      = aws_subnet.private_app[count.index].id
  route_table_id = aws_route_table.private_app.id
}

# No default route: private-data subnets are reachable only from inside the VPC.
resource "aws_route_table" "private_data" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-private-data-rt" }
}

resource "aws_route_table_association" "private_data" {
  count = 2

  subnet_id      = aws_subnet.private_data[count.index].id
  route_table_id = aws_route_table.private_data.id
}
