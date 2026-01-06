# Infrastructure as Code Guide

## Terraform Module Patterns

### 1. Standard Module Structure

```
modules/
├── vpc/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── README.md
├── eks/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── versions.tf
└── rds/
    ├── main.tf
    ├── variables.tf
    └── outputs.tf
```

### 2. VPC Module Example

```hcl
# modules/vpc/main.tf
resource "aws_vpc" "main" {
  cidr_block           = var.cidr_block
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(var.tags, {
    Name = "${var.name}-vpc"
  })
}

resource "aws_subnet" "public" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.cidr_block, 4, count.index)
  availability_zone = var.availability_zones[count.index]

  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${var.name}-public-${count.index + 1}"
    Type = "public"
  })
}

resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.cidr_block, 4, count.index + length(var.availability_zones))
  availability_zone = var.availability_zones[count.index]

  tags = merge(var.tags, {
    Name = "${var.name}-private-${count.index + 1}"
    Type = "private"
  })
}

# modules/vpc/variables.tf
variable "name" {
  type        = string
  description = "Name prefix for resources"
}

variable "cidr_block" {
  type        = string
  description = "VPC CIDR block"
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "List of availability zones"
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to resources"
  default     = {}
}

# modules/vpc/outputs.tf
output "vpc_id" {
  value       = aws_vpc.main.id
  description = "VPC ID"
}

output "public_subnet_ids" {
  value       = aws_subnet.public[*].id
  description = "Public subnet IDs"
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnet IDs"
}
```

## State Management

### Remote State Configuration

```hcl
# backend.tf
terraform {
  backend "s3" {
    bucket         = "company-terraform-state"
    key            = "prod/infrastructure.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}

# State locking table
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

### Workspace-based Environments

```hcl
# Use workspaces for environment separation
locals {
  environment = terraform.workspace

  env_config = {
    dev = {
      instance_type = "t3.small"
      min_nodes     = 1
      max_nodes     = 3
    }
    staging = {
      instance_type = "t3.medium"
      min_nodes     = 2
      max_nodes     = 5
    }
    prod = {
      instance_type = "t3.large"
      min_nodes     = 3
      max_nodes     = 10
    }
  }

  config = local.env_config[local.environment]
}

resource "aws_instance" "app" {
  instance_type = local.config.instance_type
  # ...
}
```

## Secret Handling

### AWS Secrets Manager

```hcl
# Store secrets
resource "aws_secretsmanager_secret" "db_credentials" {
  name = "${var.environment}/db-credentials"
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_password.result
  })
}

# Reference secrets (don't expose in state)
data "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
}

locals {
  db_creds = jsondecode(data.aws_secretsmanager_secret_version.db_credentials.secret_string)
}
```

### SOPS Integration

```hcl
# Decrypt secrets at plan/apply time
data "sops_file" "secrets" {
  source_file = "secrets.enc.yaml"
}

resource "kubernetes_secret" "app" {
  metadata {
    name = "app-secrets"
  }

  data = {
    api_key = data.sops_file.secrets.data["api_key"]
  }
}
```

## Cost Optimization

### Resource Tagging Strategy

```hcl
locals {
  common_tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
    CostCenter  = var.cost_center
    Owner       = var.team_email
  }
}

resource "aws_instance" "app" {
  # ...
  tags = merge(local.common_tags, {
    Name = "${var.project_name}-app"
    Role = "application"
  })
}
```

### Spot Instances for Non-Critical

```hcl
resource "aws_launch_template" "spot" {
  name_prefix   = "spot-"
  instance_type = "t3.large"

  instance_market_options {
    market_type = "spot"
    spot_options {
      max_price          = "0.05"
      spot_instance_type = "persistent"
    }
  }
}
```

## Security Best Practices

### Least Privilege IAM

```hcl
# Specific permissions, not wildcards
resource "aws_iam_policy" "app" {
  name = "app-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.data.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage"
        ]
        Resource = aws_sqs_queue.jobs.arn
      }
    ]
  })
}
```

### Security Groups

```hcl
resource "aws_security_group" "app" {
  name_prefix = "app-"
  vpc_id      = var.vpc_id

  # Only allow specific ports
  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Restrict egress
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}
```

## Anti-Patterns to Avoid

1. **Hardcoded values** - Use variables
2. **No state locking** - Race conditions corrupt state
3. **Secrets in state** - Use secret managers
4. **No versioning** - Pin module versions
5. **Large monolithic configs** - Use modules
6. **No tagging** - Impossible to track costs
7. **Wildcard IAM** - Security vulnerability
