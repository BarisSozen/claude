#!/usr/bin/env python3
"""
Terraform Scaffolder - Generates Terraform module structures
Supports: AWS, GCP, Azure
"""

import argparse
import os
from pathlib import Path

MAIN_TF_TEMPLATE = """# {module_name} Module
# Provider: {provider}

terraform {{
  required_version = ">= 1.5.0"

  required_providers {{
    {provider_block}
  }}
}}

{resources}
"""

VARIABLES_TF_TEMPLATE = """# Variables for {module_name}

variable "environment" {{
  type        = string
  description = "Environment name (dev, staging, prod)"
  validation {{
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }}
}}

variable "project_name" {{
  type        = string
  description = "Project name for resource naming"
}}

variable "tags" {{
  type        = map(string)
  description = "Tags to apply to all resources"
  default     = {{}}
}}

{additional_variables}
"""

OUTPUTS_TF_TEMPLATE = """# Outputs for {module_name}

{outputs}
"""

PROVIDERS = {
    "aws": {
        "block": """aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }""",
        "vpc_resources": """
# VPC
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-vpc"
  })
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-igw"
  })
}

# Public Subnets
resource "aws_subnet" "public" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone = var.availability_zones[count.index]

  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-public-${count.index + 1}"
    Type = "public"
  })
}

# Private Subnets
resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + length(var.availability_zones))
  availability_zone = var.availability_zones[count.index]

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-private-${count.index + 1}"
    Type = "private"
  })
}
""",
        "vpc_variables": """
variable "vpc_cidr" {
  type        = string
  description = "CIDR block for VPC"
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "List of availability zones"
}
""",
        "vpc_outputs": """
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
""",
    },
    "gcp": {
        "block": """google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }""",
        "vpc_resources": """
# VPC Network
resource "google_compute_network" "main" {
  name                    = "${var.project_name}-${var.environment}-vpc"
  auto_create_subnetworks = false
  project                 = var.gcp_project_id
}

# Public Subnet
resource "google_compute_subnetwork" "public" {
  name          = "${var.project_name}-${var.environment}-public"
  ip_cidr_range = var.public_subnet_cidr
  region        = var.region
  network       = google_compute_network.main.id
  project       = var.gcp_project_id
}

# Private Subnet
resource "google_compute_subnetwork" "private" {
  name          = "${var.project_name}-${var.environment}-private"
  ip_cidr_range = var.private_subnet_cidr
  region        = var.region
  network       = google_compute_network.main.id
  project       = var.gcp_project_id

  private_ip_google_access = true
}

# Cloud Router for NAT
resource "google_compute_router" "main" {
  name    = "${var.project_name}-${var.environment}-router"
  region  = var.region
  network = google_compute_network.main.id
  project = var.gcp_project_id
}

# Cloud NAT
resource "google_compute_router_nat" "main" {
  name                               = "${var.project_name}-${var.environment}-nat"
  router                             = google_compute_router.main.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  project                            = var.gcp_project_id
}
""",
        "vpc_variables": """
variable "gcp_project_id" {
  type        = string
  description = "GCP project ID"
}

variable "region" {
  type        = string
  description = "GCP region"
}

variable "public_subnet_cidr" {
  type        = string
  description = "CIDR for public subnet"
  default     = "10.0.1.0/24"
}

variable "private_subnet_cidr" {
  type        = string
  description = "CIDR for private subnet"
  default     = "10.0.2.0/24"
}
""",
        "vpc_outputs": """
output "network_id" {
  value       = google_compute_network.main.id
  description = "VPC network ID"
}

output "public_subnet_id" {
  value       = google_compute_subnetwork.public.id
  description = "Public subnet ID"
}

output "private_subnet_id" {
  value       = google_compute_subnetwork.private.id
  description = "Private subnet ID"
}
""",
    },
    "azure": {
        "block": """azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }""",
        "vpc_resources": """
# Resource Group
resource "azurerm_resource_group" "main" {
  name     = "${var.project_name}-${var.environment}-rg"
  location = var.location

  tags = var.tags
}

# Virtual Network
resource "azurerm_virtual_network" "main" {
  name                = "${var.project_name}-${var.environment}-vnet"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = [var.vnet_cidr]

  tags = var.tags
}

# Public Subnet
resource "azurerm_subnet" "public" {
  name                 = "public"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.vnet_cidr, 4, 0)]
}

# Private Subnet
resource "azurerm_subnet" "private" {
  name                 = "private"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.vnet_cidr, 4, 1)]
}
""",
        "vpc_variables": """
variable "location" {
  type        = string
  description = "Azure region"
}

variable "vnet_cidr" {
  type        = string
  description = "CIDR for virtual network"
  default     = "10.0.0.0/16"
}
""",
        "vpc_outputs": """
output "resource_group_name" {
  value       = azurerm_resource_group.main.name
  description = "Resource group name"
}

output "vnet_id" {
  value       = azurerm_virtual_network.main.id
  description = "Virtual network ID"
}

output "public_subnet_id" {
  value       = azurerm_subnet.public.id
  description = "Public subnet ID"
}

output "private_subnet_id" {
  value       = azurerm_subnet.private.id
  description = "Private subnet ID"
}
""",
    },
}


def scaffold_module(target_path: str, provider: str, module_type: str = "vpc"):
    """Generate Terraform module structure."""
    target = Path(target_path)
    module_name = f"{provider}-{module_type}"
    module_path = target / "modules" / module_name

    if provider not in PROVIDERS:
        raise ValueError(f"Unsupported provider: {provider}")

    provider_config = PROVIDERS[provider]

    # Create module directory
    module_path.mkdir(parents=True, exist_ok=True)

    # Generate main.tf
    main_tf = MAIN_TF_TEMPLATE.format(
        module_name=module_name,
        provider=provider.upper(),
        provider_block=provider_config["block"],
        resources=provider_config[f"{module_type}_resources"],
    )
    (module_path / "main.tf").write_text(main_tf)

    # Generate variables.tf
    variables_tf = VARIABLES_TF_TEMPLATE.format(
        module_name=module_name,
        additional_variables=provider_config[f"{module_type}_variables"],
    )
    (module_path / "variables.tf").write_text(variables_tf)

    # Generate outputs.tf
    outputs_tf = OUTPUTS_TF_TEMPLATE.format(
        module_name=module_name,
        outputs=provider_config[f"{module_type}_outputs"],
    )
    (module_path / "outputs.tf").write_text(outputs_tf)

    # Generate README
    readme = f"""# {module_name.upper()} Module

Terraform module for {provider.upper()} {module_type.upper()} infrastructure.

## Usage

```hcl
module "{module_type}" {{
  source = "./modules/{module_name}"

  environment  = "prod"
  project_name = "myproject"
  tags         = {{ ManagedBy = "terraform" }}
}}
```

## Requirements

- Terraform >= 1.5.0
- {provider.upper()} provider ~> 5.0

## Resources Created

See `main.tf` for full resource list.
"""
    (module_path / "README.md").write_text(readme)

    print(f"Scaffolded Terraform module: {module_path}")
    print(f"  Provider: {provider.upper()}")
    print(f"  Module type: {module_type}")
    print(f"  Files created: main.tf, variables.tf, outputs.tf, README.md")


def main():
    parser = argparse.ArgumentParser(description="Scaffold Terraform modules")
    parser.add_argument("target_path", help="Target directory for module")
    parser.add_argument(
        "--provider",
        choices=["aws", "gcp", "azure"],
        default="aws",
        help="Cloud provider (default: aws)",
    )
    parser.add_argument(
        "--module-type",
        choices=["vpc"],
        default="vpc",
        help="Module type (default: vpc)",
    )

    args = parser.parse_args()
    scaffold_module(args.target_path, args.provider, args.module_type)


if __name__ == "__main__":
    main()
