# Prepares local environment for development

base_dir="$(cd "$(dirname $0)" &>/dev/null && pwd)"

source "${base_dir}/functions.sh"

if ! [[ "${directory_name}" == 'portfolio-website' ]]; then
  fail "ERROR: Script cannot be run outside project's root."
fi

brew_dependencies
node_dependencies
configure_awscli
configure_pulumi
