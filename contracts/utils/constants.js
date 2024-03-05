const { BigNumber } = require("ethers");

const MAX_UINT256 = BigNumber.from(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
);
const threeCRVPid = 9;
const metapoolLPCRVPid = 56;
const lusdMetapoolLPCRVPid = 33;
const oethPoolLpPID = 174;

// stETH/WETH
const aura_stETH_WETH_PID = 115;
const balancer_stETH_WETH_PID =
  "0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080";

// wstETH/sfrxETH/rETH
const aura_wstETH_sfrxETH_rETH_PID = 50;
const balancer_wstETH_sfrxETH_rETH_PID =
  "0x42ed016f826165c2e5976fe5bc3df540c5ad0af700000000000000000000058b";

// rETH/WETH
const aura_rETH_WETH_PID = 109;
const balancer_rETH_WETH_PID =
  "0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112";

const CCIPChainSelectors = {
  ArbitrumOne: "4949039107694359620",
  Mainnet: "5009297550715157269",
};

const L2GovernanceCommands = {
  Queue: "0x0001",
  Cancel: "0x0002",
};

module.exports = {
  threeCRVPid,
  metapoolLPCRVPid,
  lusdMetapoolLPCRVPid,
  oethPoolLpPID,
  MAX_UINT256,
  aura_stETH_WETH_PID,
  balancer_stETH_WETH_PID,
  aura_wstETH_sfrxETH_rETH_PID,
  balancer_wstETH_sfrxETH_rETH_PID,
  aura_rETH_WETH_PID,
  balancer_rETH_WETH_PID,
  CCIPChainSelectors,
  L2GovernanceCommands,
};

// These are all the metapool ids. For easier future reference
// 0 0x845838DF265Dcd2c412A1Dc9e959c7d08537f8a2
// 1 0x9fC689CCaDa600B6DF723D9E47D84d76664a1F23
// 2 0xdF5e0e81Dff6FAF3A7e52BA697820c5e32D806A8
// 3 0x3B3Ac5386837Dc563660FB6a0937DFAa5924333B
// 4 0xC25a3A3b969415c80451098fa907EC722572917F
// 5 0xD905e2eaeBe188fc92179b6350807D8bd91Db0D8
// 6 0x49849C98ae39Fff122806C06791Fa73784FB3675
// 7 0x075b1bb99792c9E1041bA13afEf80C91a1e70fB3
// 8 0xb19059ebb43466C323583928285a49f558E572Fd
// 9 0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490
// 10 0xD2967f45c4f384DEEa880F807Be904762a3DeA07
// 11 0x5B5CFE992AdAC0C9D48E05854B2d91C73a003858
// 12 0x97E2768e8E73511cA874545DC5Ff8067eB19B787
// 13 0x4f3E8F405CF5aFC05D68142F3783bDfE13811522
// 14 0x1AEf73d49Dedc4b1778d0706583995958Dc862e6
// 15 0xC2Ee6b0334C261ED60C72f6054450b61B8f18E35
// 16 0x64eda51d3Ad40D56b9dFc5554E06F94e1Dd786Fd
// 17 0x3a664Ab939FD8482048609f652f9a0B0677337B9
// 18 0xDE5331AC4B3630f94853Ff322B66407e0D6331E8
// 19 0x410e3E86ef427e30B9235497143881f717d93c2A
// 20 0x2fE94ea3d5d4a175184081439753DE15AeF9d614
// 21 0x94e131324b6054c0D789b190b2dAC504e4361b53
// 22 0x194eBd173F6cDacE046C53eACcE9B953F28411d1
// 23 0xA3D87FffcE63B53E0d54fAa1cc983B7eB0b74A9c
// 24 0xFd2a8fA60Abd58Efe3EeE34dd494cD491dC14900
// 25 0x06325440D014e39736583c165C2963BA99fAf14E
// 26 0x02d341CcB60fAaf662bC0554d13778015d1b285C
// 27 0xaA17A236F2bAdc98DDc0Cf999AbB47D47Fc0A6Cf
// 28 0x7Eb40E450b9655f4B3cC4259BCC731c63ff55ae6
// 29 0x5282a4eF67D9C33135340fB3289cc1711c13638C
// 30 0xcee60cFa923170e4f8204AE08B4fA6A3F5656F3a
// 31 0xEcd5e75AFb02eFa118AF914515D6521aaBd189F1
// 32 0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B
// 33 0xEd279fDD11cA84bEef15AF5D39BB4d4bEE23F0cA
// 34 0x4807862AA8b2bF68830e4C8dc86D0e9A998e085a
// 35 0x53a901d48795C58f485cBB38df08FA96a24669D5
// 36 0x43b4FdFD4Ff969587185cDB6f0BD875c5Fc83f8c
// 37 0xcA3d75aC011BF5aD07a98d02f18225F9bD9A6BDF
// 38 0xc4AD29ba4B3c580e6D59105FFf484999997675Ff
// 39 0xFD5dB7463a3aB53fD211b4af195c5BCCC1A03890
// 40 0x5a6A4D54456819380173272A5E8E9B9904BdF41B
// 41 0x9D0464996170c6B9e75eED71c68B99dDEDf279e8
// 42 0x8818a9bb44Fbf33502bE7c15c500d0C783B73067
// 43 0xD6Ac1CB9019137a896343Da59dDE6d097F710538
// 44 0x3F1B0278A9ee595635B61817630cC19DE792f506
// 45 0x19b080FE1ffA0553469D20Ca36219F17Fcf03859
// 46 0x9c2C8910F113181783c249d8F6Aa41b51Cde0f0c
// 47 0x8461A004b50d321CB22B7d034969cE6803911899
// 48 0xB15fFb543211b558D40160811e5DcBcd7d5aaac9
// 49 0xC4C319E2D4d66CcA4464C0c2B32c9Bd23ebe784e
// 50 0x3Fb78e61784C9c637D560eDE23Ad57CA1294c14a
// 51 0x5B3b5DF2BF2B6543f78e053bD91C4Bdd820929f1
// 52 0x55A8a39bc9694714E2874c1ce77aa1E599461E18
// 53 0xFbdCA68601f835b27790D98bbb8eC7f05FDEaA9B
// 54 0x3D229E1B4faab62F621eF2F6A610961f7BD7b23B
// 55 0x3b6831c0077a1e44ED0a21841C3bC4dC11bCE833
// 56 0x87650D7bbfC3A9F10587d7778206671719d9910D
// 57 0xc270b3B858c335B6BA5D5b10e2Da8a09976005ad
// 58 0xBaaa1F5DbA42C3389bDbc2c9D2dE134F5cD0Dc89
// 59 0xCEAF7747579696A2F0bb206a14210e3c9e6fB269
// 60 0xb9446c4Ef5EBE66268dA6700D26f96273DE3d571
// 61 0xEd4064f376cB8d68F770FB1Ff088a3d0F3FF5c4d
// 62 0xAA5A67c256e27A5d80712c51971408db3370927D
// 63 0x6BA5b4e438FA0aAf7C1bD179285aF65d13bD3D90
// 64 0x3A283D9c08E8b55966afb64C515f5143cf907611
// 65 0x8484673cA7BfF40F82B041916881aeA15ee84834
// 66 0x8282BD15dcA2EA2bDf24163E8f2781B30C43A2ef
// 67 0xCb08717451aaE9EF950a2524E33B6DCaBA60147B
// 68 0x29059568bB40344487d62f7450E78b8E6C74e0e5
// 69 0x90244F43D548a4f8dFecfAD91a193465B1fad6F7
// 70 0xB37D6c07482Bc11cd28a1f11f1a6ad7b66Dec933
// 71 0x06cb22615BA53E60D67Bf6C341a0fD5E718E1655
// 72 0xF3A43307DcAFa93275993862Aae628fCB50dC768
// 73 0x447Ddd4960d9fdBF6af9a790560d0AF76795CB08
// 74 0x137469B55D1f15651BA46A89D0588e97dD0B6562
// 75 0xE160364FD8407FFc8b163e278300c6C5D18Ff61d
// 76 0xbcb91E689114B9Cc865AD7871845C95241Df4105
// 77 0xC9467E453620f16b57a34a770C6bceBECe002587
// 78 0x2302aaBe69e6E7A1b0Aa23aAC68fcCB8A4D2B460
// 79 0x1054Ff2ffA34c055a13DCD9E0b4c0cA5b3aecEB9
// 80 0x3a70DfA7d2262988064A2D051dd47521E43c9BdD
// 81 0x401322B9FDdba8c0a8D40fbCECE1D1752C12316B
// 82 0x4704aB1fb693ce163F7c9D3A31b3FF4eaF797714
// 83 0x6359B6d3e327c497453d4376561eE276c6933323
// 84 0x54c8Ecf46A81496eEB0608BD3353388b5D7a2a33
// 85 0x08ceA8E5B4551722dEB97113C139Dd83C26c5398
// 86 0x8682Fbf0CbF312C891532BA9F1A91e44f81ad7DF
// 87 0x22CF19EB64226e0E1A79c69b345b31466fD273A7
// 88 0x127091edE112aEd7Bae281747771b3150Bb047bB
// 89 0x80CAcCdBD3f07BbdB558DB4a9e146D099933D677
// 90 0x4647B6D835f3B393C7A955df51EEfcf0db961606
// 91 0x8EE017541375F6Bcd802ba119bdDC94dad6911A1
// 92 0x3660BD168494d61ffDac21E403d0F6356cF90fD7
// 93 0xf7b55C3732aD8b2c2dA7c24f30A69f55c54FB717
// 94 0x48fF31bBbD8Ab553Ebe7cBD84e1eA3dBa8f54957
// 95 0xdf55670e27bE5cDE7228dD0A6849181891c9ebA1
// 96 0xe6b5CC1B4b47305c58392CE3D359B10282FC36Ea
// 97 0xbE4f3AD6C9458b901C81b734CB22D9eaE9Ad8b50
// 98 0x8c524635d52bd7b1Bd55E062303177a7d916C046
// 99 0x7ea4aD8C803653498bF6AC1D2dEbc04DCe8Fd2aD
// 100 0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC
// 101 0xe3c190c57b5959Ae62EfE3B6797058B76bA2f5eF
// 102 0x497CE58F34605B9944E6b15EcafE6b001206fd25
// 103 0x04b727C7e246CA70d496ecF52E6b6280f3c8077D
// 104 0x4e43151b78b5fbb16298C1161fcbF7531d5F8D93
// 105 0x8fdb0bB9365a46B145Db80D0B1C5C5e979C84190
// 106 0xB30dA2376F63De30b42dC055C93fa474F31330A5
// 107 0x4606326b4Db89373F5377C316d3b0F6e55Bc6A20
// 108 0x33baeDa08b8afACc4d3d07cf31d49FC1F1f3E893
// 109 0xdaDfD00A2bBEb1abc4936b1644a3033e1B653228
// 110 0x70fc957eb90E37Af82ACDbd12675699797745F68
// 111 0xfa65aa60a9D45623c57D383fb4cf8Fb8b854cC4D
// 112 0xe7A3b38c39F97E977723bd1239C3470702568e7B
// 113 0xBa3436Fd341F2C8A928452Db3C5A3670d1d5Cc73
// 114 0xC47EBd6c0f68fD5963005D28D0ba533750E5C11B
// 115 0xE57180685E3348589E9521aa53Af0BCD497E884d
// 116 0x22e859Ee894c2068920858A60b51DC03ac5581c1
// 117 0x7F17A6C77C3938D235b014818092eb6305BdA110
// 118 0x527331F3F550f6f85ACFEcAB9Cc0889180C6f1d5
// 119 0xF57ccaD8122B898A147Cc8601B1ECA88B1662c7E
// 120 0xf985005a3793DbA4cCe241B3C19ddcd3Fe069ff4
// 121 0x66E335622ad7a6C9c72c98dbfCCE684996a20Ef9
