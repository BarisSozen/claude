#!/usr/bin/env python3
"""
Deployment Manager - Orchestrates production deployments
Supports: Blue-Green, Canary, Rolling strategies
"""

import argparse
import subprocess
import sys
import time
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class Strategy(Enum):
    BLUE_GREEN = "blue-green"
    CANARY = "canary"
    ROLLING = "rolling"


@dataclass
class DeploymentConfig:
    namespace: str
    deployment: str
    image: str
    strategy: Strategy
    replicas: int = 3
    canary_weight: int = 10
    canary_steps: list = None
    health_check_path: str = "/health"
    timeout_seconds: int = 300


def run_kubectl(args: list, check: bool = True) -> subprocess.CompletedProcess:
    """Run kubectl command."""
    cmd = ["kubectl"] + args
    print(f"  Running: {' '.join(cmd)}")
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def check_deployment_health(config: DeploymentConfig) -> bool:
    """Check if deployment is healthy."""
    result = run_kubectl([
        "get", "deployment", config.deployment,
        "-n", config.namespace,
        "-o", "jsonpath={.status.availableReplicas}"
    ], check=False)

    if result.returncode != 0:
        return False

    available = int(result.stdout or "0")
    return available >= config.replicas


def wait_for_rollout(config: DeploymentConfig) -> bool:
    """Wait for rollout to complete."""
    print(f"Waiting for rollout (timeout: {config.timeout_seconds}s)...")

    result = run_kubectl([
        "rollout", "status", f"deployment/{config.deployment}",
        "-n", config.namespace,
        f"--timeout={config.timeout_seconds}s"
    ], check=False)

    return result.returncode == 0


def deploy_blue_green(config: DeploymentConfig) -> bool:
    """Execute blue-green deployment."""
    print(f"\n{'='*50}")
    print(f"Blue-Green Deployment: {config.deployment}")
    print(f"{'='*50}")

    # Determine current color
    result = run_kubectl([
        "get", "service", config.deployment,
        "-n", config.namespace,
        "-o", "jsonpath={.spec.selector.version}"
    ], check=False)

    current_color = result.stdout.strip() if result.returncode == 0 else "blue"
    new_color = "green" if current_color == "blue" else "blue"

    print(f"\n[1/4] Current version: {current_color}, deploying: {new_color}")

    # Create new deployment
    print(f"\n[2/4] Creating {new_color} deployment...")
    new_deployment = f"{config.deployment}-{new_color}"

    run_kubectl([
        "set", "image", f"deployment/{new_deployment}",
        f"app={config.image}",
        "-n", config.namespace
    ], check=False)

    # Wait for new deployment
    print(f"\n[3/4] Waiting for {new_color} deployment to be ready...")
    if not wait_for_rollout(DeploymentConfig(
        namespace=config.namespace,
        deployment=new_deployment,
        image=config.image,
        strategy=config.strategy,
        timeout_seconds=config.timeout_seconds
    )):
        print(f"ERROR: {new_color} deployment failed to become ready")
        return False

    # Switch service
    print(f"\n[4/4] Switching service to {new_color}...")
    run_kubectl([
        "patch", "service", config.deployment,
        "-n", config.namespace,
        "-p", f'{{"spec":{{"selector":{{"version":"{new_color}"}}}}}}'
    ])

    print(f"\nBlue-green deployment complete. Active: {new_color}")
    return True


def deploy_canary(config: DeploymentConfig) -> bool:
    """Execute canary deployment."""
    print(f"\n{'='*50}")
    print(f"Canary Deployment: {config.deployment}")
    print(f"{'='*50}")

    steps = config.canary_steps or [10, 25, 50, 75, 100]

    for i, weight in enumerate(steps):
        print(f"\n[Step {i+1}/{len(steps)}] Setting canary weight to {weight}%")

        # Update canary deployment
        run_kubectl([
            "set", "image", f"deployment/{config.deployment}-canary",
            f"app={config.image}",
            "-n", config.namespace
        ], check=False)

        # Scale canary based on weight
        canary_replicas = max(1, int(config.replicas * weight / 100))
        stable_replicas = config.replicas - canary_replicas

        run_kubectl([
            "scale", f"deployment/{config.deployment}-canary",
            f"--replicas={canary_replicas}",
            "-n", config.namespace
        ], check=False)

        run_kubectl([
            "scale", f"deployment/{config.deployment}",
            f"--replicas={stable_replicas}",
            "-n", config.namespace
        ], check=False)

        if weight < 100:
            print(f"  Canary: {canary_replicas} replicas, Stable: {stable_replicas} replicas")
            print(f"  Waiting 60s before next step...")
            time.sleep(60)

            # Check health
            if not check_deployment_health(config):
                print("ERROR: Health check failed, initiating rollback")
                rollback(config)
                return False

    print("\nCanary deployment complete. Promoting to stable...")

    # Promote canary to stable
    run_kubectl([
        "set", "image", f"deployment/{config.deployment}",
        f"app={config.image}",
        "-n", config.namespace
    ])

    return wait_for_rollout(config)


def deploy_rolling(config: DeploymentConfig) -> bool:
    """Execute rolling deployment."""
    print(f"\n{'='*50}")
    print(f"Rolling Deployment: {config.deployment}")
    print(f"{'='*50}")

    print("\n[1/2] Updating deployment image...")
    run_kubectl([
        "set", "image", f"deployment/{config.deployment}",
        f"app={config.image}",
        "-n", config.namespace
    ])

    print("\n[2/2] Waiting for rollout to complete...")
    success = wait_for_rollout(config)

    if success:
        print("\nRolling deployment complete.")
    else:
        print("\nERROR: Rolling deployment failed")

    return success


def rollback(config: DeploymentConfig) -> bool:
    """Rollback deployment to previous version."""
    print(f"\n{'='*50}")
    print(f"Rolling back: {config.deployment}")
    print(f"{'='*50}")

    result = run_kubectl([
        "rollout", "undo", f"deployment/{config.deployment}",
        "-n", config.namespace
    ], check=False)

    if result.returncode == 0:
        print("Rollback initiated successfully")
        return wait_for_rollout(config)

    print(f"ERROR: Rollback failed: {result.stderr}")
    return False


def deploy(config: DeploymentConfig) -> bool:
    """Execute deployment based on strategy."""
    strategies = {
        Strategy.BLUE_GREEN: deploy_blue_green,
        Strategy.CANARY: deploy_canary,
        Strategy.ROLLING: deploy_rolling,
    }

    deploy_fn = strategies.get(config.strategy)
    if not deploy_fn:
        print(f"ERROR: Unknown strategy: {config.strategy}")
        return False

    return deploy_fn(config)


def main():
    parser = argparse.ArgumentParser(description="Manage production deployments")
    parser.add_argument(
        "--strategy",
        choices=["blue-green", "canary", "rolling"],
        default="rolling",
        help="Deployment strategy",
    )
    parser.add_argument("--namespace", "-n", default="default", help="Kubernetes namespace")
    parser.add_argument("--deployment", "-d", required=True, help="Deployment name")
    parser.add_argument("--image", "-i", required=True, help="Container image")
    parser.add_argument("--replicas", "-r", type=int, default=3, help="Number of replicas")
    parser.add_argument("--timeout", "-t", type=int, default=300, help="Timeout in seconds")
    parser.add_argument("--rollback", action="store_true", help="Rollback deployment")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done")

    args = parser.parse_args()

    config = DeploymentConfig(
        namespace=args.namespace,
        deployment=args.deployment,
        image=args.image,
        strategy=Strategy(args.strategy),
        replicas=args.replicas,
        timeout_seconds=args.timeout,
    )

    if args.dry_run:
        print("DRY RUN - would execute:")
        print(f"  Strategy: {config.strategy.value}")
        print(f"  Namespace: {config.namespace}")
        print(f"  Deployment: {config.deployment}")
        print(f"  Image: {config.image}")
        print(f"  Replicas: {config.replicas}")
        return

    if args.rollback:
        success = rollback(config)
    else:
        success = deploy(config)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
