certoraRun ../spec/harnesses/OUSDHarness.sol --verify OUSDHarness:../spec/ousd.spec --solc solc5.11 --settings -useNonLinearArithmetic,-t=300,-ignoreViewFunctions --cloud --msg "OUSD NLA ${1} method" --settings -rule=${1},-m=${2},-s=cvc4
