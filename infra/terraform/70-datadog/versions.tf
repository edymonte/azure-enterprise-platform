terraform {
  required_version = ">= 1.12.2, < 2.0.0"

  required_providers {
    datadog = {
      source  = "DataDog/datadog"
      version = "~> 3.60"
    }
  }
}
