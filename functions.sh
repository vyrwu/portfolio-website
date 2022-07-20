# This file is library containing a few helper functions.
# It is supposed to be sourced and used in the main scripts.

# Global variables

base_dir="$(cd "$(dirname $0)" &>/dev/null && pwd)"
directory_name=$(basename "${base_dir}")

# Color

RED='\033[0;31m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
LIGHT_BLUE='\033[1;36m'
GREEN='\033[0;32m'
LIGHT_GREEN='\033[1;32m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Functions

# Print an informative message
function info() {
  echo
  echo -e "  [${LIGHT_BLUE}INFO${NC}] $@"
}

# Print an error message
function error() {
  echo
  echo -e "  [${RED}ERROR${NC}] $@"
}

# Print a success message
function success() {
  echo
  echo -e "  [${GREEN}OK${NC}] $@"
}

function fail() {
  error "$@"
  exit 1
}

# Print the given text in a specific header/title format
function title() {
  text=$@
  echo -e "> ${BOLD}${text}${NC}"
}

# Print the usage of a function or script
function usage() {
  echo
  echo -e "usage: ${usage}"
  echo
  exit 2
}

# Prints an option selector
function select_from_list() {
  resource_name=$1
  shift
  options=("$@")

  if [[ ${#options[@]} -eq 0 ]]
  then
    return -1
  elif [[ ${#options[@]} -eq 1 ]]
  then
    return 0
  else [[ ${#options[@]} -gt 1 ]]
    echo
    echo "  Existing ${resource_name}s:"
    echo
    for ((i=0; i < ${#options[@]}; i++))
    do
      echo "  $((i+1)). ${options[i]}"
    done
    echo

    read -p "  Select a ${resource_name} by the number: " selected_number
    return $((selected_number-1))
  fi
}

# Check whether a given binary is present in the $PATH
function check_dependency {
  local usage='check_dependency <binary>'
  [[ $# -eq 1 ]] && [[ -n $1 ]] || usage
  dependency=$1
  which "${dependency}" &>/dev/null || fail 'The binary '${dependency}' was not found in the $PATH. Please, install it and try again.'
}

function brew_dependencies() {
  info "Checking dependencies:"
  dependencies_binaries=(git node aws pulumi)
  brew_dependencies=(git node awscli pulumi)

  for ((i = 0 ; i < ${#dependencies_binaries[@]} ; i++))
  do
    binary="${dependencies_binaries[i]}"
    dependency="${brew_dependencies[i]}"

    if ! which "${binary}" &>/dev/null
    then
      info "Installing ${dependency} via Brew..."
      if ! brew install "${dependency}" &>/dev/null
      then
        error "Failed to install ${dependency}  "
        return 1
      fi
    fi
    success "${dependency}"
  done
}

function node_dependencies() {
  info "Installing Node dependencies for '${directory_name}':"
  cd "${base_dir}" &>/dev/null
  if ! npm ci --no-fund --no-audit --loglevel error  &>/dev/null
  then
     error "Failed to install Node dependencies"
     return 1
  else
    success "Node dependencies successfully installed"
  fi
  cd - &>/dev/null
}

function configure_awscli() {
  available_profiles=($(aws configure list-profiles))
  
  info "Configuring AWS CLI:"

  if [[ -z "${AWS_PROFILE}" ]]
  then
    if [[ ${#available_profiles[@]} -gt 0 ]]
    then
      available_profiles+=('new')
      select_from_list 'AWS profile' "${available_profiles[@]}"
      selected_profile=${available_profiles[$?]}
    else
      selected_profile='new'
    fi

    if [[ "${selected_profile}" == 'new' ]]
    then
      read -p "  Name for the new AWS profile: " AWS_PROFILE
      aws configure --profile "${AWS_PROFILE}"
    else
      AWS_PROFILE="${selected_profile}"
    fi

    if ! aws configure get "profile.${AWS_PROFILE}.aws_access_key_id" &>/dev/null
    then
      echo "  [ERROR] Invalid AWS profile (${AWS_PROFILE})"
      return 1
    fi

    echo
    echo "  [OK] AWS CLI successfully configured. Using profile '${AWS_PROFILE}'"
  else
    echo "  [OK] Using preset profile '${AWS_PROFILE}'"
  fi

  export AWS_PROFILE
  export AWS_REGION="$(aws configure get profile.${AWS_PROFILE}.region)"
  export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --output text --query "Account")"
}

function configure_pulumi() {
  local pulumi_organzation='vyrwu'
  
  info "Configuring Pulumi for '${directory_name}':"

  cd "${base_dir}" &>/dev/null

  if [[ $# -gt 0 ]]
  then
    pulumi_stack="${pulumi_organzation}/${1}"
    if ! pulumi stack select --create "${pulumi_stack}" &>/dev/null
    then
      error "Failed to create Pulumi stack '${pulumi_stack}'"
      return 1
    fi
  else
    pulumi stack select
  fi

  stack_name=$(pulumi stack --show-name)

  cd - &>/dev/null
}
