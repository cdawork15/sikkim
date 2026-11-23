#!/bin/bash
# Creates or updates the AWS stack, then stores its outputs as variables of the
# GitHub "production" environment so .github/workflows/deploy.yml can ship.
# Run from your machine after `aws login` and `gh auth login`:
#
#   deploy/aws/setup.sh
#
# Optional environment: AWS_REGION (default ap-southeast-2), STACK_NAME
# (default sikkim-prod), GITHUB_REPO (default: this checkout's GitHub repo).
set -euo pipefail
cd "$(dirname "$0")"

export AWS_REGION=${AWS_REGION:-ap-southeast-2}
STACK_NAME=${STACK_NAME:-sikkim-prod}
GITHUB_REPO=${GITHUB_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}

aws sts get-caller-identity --query Arn --output text >/dev/null

prefix_list=$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text)

overrides=(Name="$STACK_NAME" GitHubRepo="$GITHUB_REPO" CloudFrontOriginPrefixList="$prefix_list")
if ! aws cloudformation describe-stacks --stack-name "$STACK_NAME" >/dev/null 2>&1; then
  # First deploy only: pin today's Ubuntu 24.04 arm64 image (a new image
  # would replace the server) and reuse an existing GitHub OIDC provider.
  ami=$(aws ssm get-parameter \
    --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value --output text)
  oidc=$(aws iam list-open-id-connect-providers \
    --query "OpenIDConnectProviderList[?ends_with(Arn, '/token.actions.githubusercontent.com')].Arn | [0]" \
    --output text)
  [ "$oidc" = None ] && oidc=''
  overrides+=(AmiId="$ami" GitHubOidcProviderArn="$oidc")
fi

echo "Deploying stack $STACK_NAME in $AWS_REGION (CloudFront and RDS take 15-25 minutes the first time)..."
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file stack.yaml \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --tags Project=sikkim-experiences Stack="$STACK_NAME" \
  --parameter-overrides "${overrides[@]}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "Configuring the GitHub production environment for $GITHUB_REPO..."
gh api -X PUT "repos/$GITHUB_REPO/environments/production" --silent \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api "repos/$GITHUB_REPO/environments/production/deployment-branch-policies" \
  --jq '.branch_policies[].name' | grep -qx main ||
  gh api -X POST "repos/$GITHUB_REPO/environments/production/deployment-branch-policies" \
    --silent -f name=main -f type=branch

set_var() { gh variable set "$1" --env production --repo "$GITHUB_REPO" --body "$2"; }
set_var AWS_REGION "$AWS_REGION"
set_var AWS_DEPLOY_ROLE_ARN "$(output DeployRoleArn)"
set_var RELEASE_BUCKET "$(output ReleaseBucketName)"
set_var INSTANCE_ID "$(output InstanceId)"
set_var DISTRIBUTION_ID "$(output DistributionId)"
set_var SERVER_CONFIG_PARAM "$(output ConfigParameter)"
set_var APP_URL "$(output AppUrl)"

echo "Done. App URL: $(output AppUrl)"
echo "Push to main (or run the Deploy workflow) to ship the first release."
