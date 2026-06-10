// Audit-scope filtering rules, ported from the BAMC/Compass inventory cleaner
// (clean_inventory.py). Buckets, in precedence order:
//   non_food -> do_not_inventory -> zero_qty -> single_ingredient -> in scope
// Structural rules (do-not-inventory, zero qty, duplicates) reproduce exactly
// on any house. NON_FOOD/SINGLE are keyword heuristics tuned to the vocabulary
// seen so far — glance at the import summary per house and extend as needed.

// Categories that are packaging / disposables / jan-san, never food.
export const NONFOOD_CATS = new Set([
  'HOT DRINK PRINT', 'HOT DRINK', 'CUPS SOFT', 'CUPS PLASTIC', 'CUPS PAPER', 'CUPS CLEAR HARD', 'CUPS FOAM',
  'FORKS STYRENE', 'KNIVES STYRENE', 'SPOON STYRENE', 'KITS STYRENE', 'KITS POLYPROP', 'CHOPSTICKS', 'STIRRERS',
  'WAX PLAIN', 'DELI  WAXED', 'DELI WAXED', 'PAPER WRAPPED', 'JACKET/WRAP/SLV', 'SHEETS LAM', 'FULLFOLD', 'ICE TEA',
  'VINYL FOODSERVICE', 'NITRILE FOODSERVICE', 'CONTAINERS PLAS', 'CUTTER SLIDE', 'HINGED LID OPS', 'HINGED LID PET',
  'HINGED LID PP', 'HINGED LID PLA', 'CLEANER', 'FLAT FOLDED', 'CARRY-OUT W HDL', 'SUPPLIES-CONT-TAKE OUT',
  'LINER PAN QUILL', 'ROLL CUTTER BOX', 'CHEESECLOTH', 'BUNPAN RACK COV', 'POLY FOODSERVICE', 'MLD FIBER', 'PLATE',
  'FOOD W LID PP', 'FOOD W LID PET', 'FOOD  NO LID', 'FOOD PAPER', 'FOOD PAPER PRT', 'HARDWOUND ROLL', 'BOWLS',
  'BOXES  PIZZA', 'BOPP HI-CLARITY', 'PUMP DISPENSER', 'WET MOP/CUT END', 'PADS SCRUBBERS', 'CONTINUOUS PERF ROLL',
  'TOWELETTE MOIST', 'WICK/LIQ/FUEL', 'PACKAGING MATERIALS', 'HOT DOG',
]);

export const NON_FOOD = new RegExp([
  '\\bLID\\b', '\\bLIDS\\b', '\\bWRAP\\b', '\\bFOIL\\b', '\\bFILM\\b', 'STIRRER', 'NAPKIN', '\\bTOWEL', 'TISSUE',
  'CONTAINER', '\\bTRAY\\b', '\\bTRAYS\\b', 'CHOPSTICK', '\\bGLOVE', '\\bLINER', '\\bMOP\\b', 'CLEANER', 'CLEANING',
  // \bBLEACH (not bare BLEACH): "FLOUR UNBLEACHED" is food.
  'SANITIZ', 'DEGREAS', 'DETERGENT', '\\bSOAP\\b', '\\bBLEACH', 'DISINFECT', 'POLISH', 'SCRUB', 'SPONGE',
  '\\bFILTER', 'CHEESECLOTH', 'PARCHMENT', 'DOILY', '\\bWICK', 'STERNO', 'DISPENSER', 'CAN LINER', 'TRASH',
  'GARBAGE', 'DESCALER', 'DESCLAER', 'URNEX', 'PRESOAK', '\\bRINSE\\b', 'DELIMER', 'SADDLE PACK', '\\bSLEEVE',
  '\\bWIPE', 'CUTLERY', 'DISH MACHINE', '\\bAPRON', 'HAIRNET', 'HAIR NET', 'SCOURING', '\\bSANI\\b', 'QUAT\\b',
  '\\bRAGS?\\b', '^CUP (PAPER|PLAS|PLASTIC|FOAM|HOT|COLD|CLR|CLEAR|GREENWARE|PORTION|SOUFFLE|SOUP)', '^LID\\b',
  '\\bCUP HOT\\b', 'CUP PAPER', 'CUP PLAS', 'CUP FOAM', 'CUP GREENWARE', '\\bPORTION CUP', 'SOUFFLE CUP',
  '\\bBAG (PAPER|PLAS|POLY|T-?SACK|ZIP|RECLOS|SADDLE|MERCH|HANDL|DELI|ICE)', '^BAG ', 'STRAW PAPER',
  'STRAW PLAS', 'STRAW WRAP', 'STRAW JUMBO', 'STRAW FLEX', '\\bSTRAWS\\b', '\\bFORK\\b', '\\bFORKS\\b', '\\bKNIFE\\b',
  'KNIVES', '\\bSPOON\\b', '\\bSPOONS\\b', '\\bKIT CUTLERY', 'INSERT PLAS', 'PAN LINER', 'PALETTE', '^PAIL\\b',
  '\\bPAILS\\b', 'PORTION PAPER',
].join('|'));

// Protects food-in-a-vessel ("FRUIT CUP", "PEANUT BUTTER CUP", "WRAP TORTILLA")
// from the NON_FOOD keywords.
export const FOOD_GUARD = new RegExp(
  'PEANUT BUTTER CUP|JELLY.*CUP|JELLY ASST CUP|HONEY.*CUP|SYRUP.*CUP|FRUIT CUP|EGG CUP|YOGURT|PARFAIT|' +
  'OVERNIGHT OAT|SPREAD CUP|PUDDING|APPLESAUCE|GELATIN|JAM CUP|ICE CREAM(?! CUP)|TEA BAG|STRAWBERR|STRAWBRY|' +
  'STRAW/|BUB TEA|CREAMY CUP|MUSTARD.*CUP|KETCHUP.*CUP|SAUCE.*CUP|DRESSING.*CUP|SOUR PATCH|CANDY|\\bNUT\\b|' +
  'PASTA|NOODLE|\\bPAD THAI|WRAP TORTILLA|TORTILLA WRAP|\\bTORTILLA\\b');

// Items that must STAY in scope even though they look single-ingredient.
export const SINGLE_KEEP = new RegExp(
  'DELI SMKD|BRGR SAVRY|SAUSAGE|SEASONING|SEASON FILE|CURRY POWDER|GARAM|FIVE CHINESE|PICKLING|CHILI POWDER|' +
  'VEGAN|CHEDDAR JACK|MOZZ/PROV FEA|AMERICAN|CHEDDAR SHRD VEGAN|RICE SEASONED|TEA CONC|SPRKLG LEMON|' +
  'WHIPPED REAL');

// Single-ingredient commodities / staples — no multi-ingredient label to audit.
export const SINGLE = new RegExp(
  '^FLOUR|^SUGAR (?!SUB)|SUGAR (BROWN|IN THE RAW|GRANULATED|TURBINADO)|SUGAR PACKET CANE|^SALT\\b|' +
  'SALT (KOSHER|PACKET)|BAKING SODA|CORN STARCH|^SPICE |^BAY LEAF|TARRAGON LEAVES|SEEDS CHIA|^HONEY|MOLASSES|' +
  '^RICE |GRAIN QUINOA|GRAIN WHEAT|WHEAT BERRIES|FARRO|COUSCOUS|^PASTA |NOODLE YAKISOBA|CEREAL HOT OAT|' +
  '^OIL |TRUFFLE BIANCO|SHORTENING|PAN COATING|^VINEGAR |WHOLE BEAN|WHIOLE BEAN|^NUMI|TEA MATCHA|' +
  '^JUICE (LEMON|LIME|APPLE|CLAM)|TROPICANA|MINCED CLAM|^MILK (WHL|2%|SKIM)|FAIRLIFE|CREAM HEAVY|' +
  'CREAM SOUR PURE|HALF & HALF|^EGG |EGG SHELL|EGG WHL|EGG HARDCOOK|HARD EGG CUP|YOGURT PLAIN GREEK|' +
  'BUTTER CHIP CNTL SLTD|^CHEESE (FETA|PARM|PARMESAN|CHEDDAR MILD|PEPPER JACK|PROVOLONE|MOZZ FRSH|BLUE|' +
  'SWISS|CREAM SOFT ORIG|CREAM ORIG SPREAD)|CHESTNUT WATER|CORN BABY|CORN WHL KERNEL|^PEA GREEN|SOYBEAN|' +
  'EDAMAME|ORGANIC TOFU|GARLIC PEELED|ONION PEARL|MANGO CHUNK|PINEAPPLE DICED|OLIVE KALAMATA|^CAPER|' +
  'MUSH SHIITAKE|\\bRAISIN|SAUERKRAUT|SEAWEED NORI|BEAN LENTIL|BEAN BLACK|BEAN GARBANZO|BEAN GREAT|' +
  'TOMATO PASTE|TOMATO DICED|CHICKEN BREAST B/S|HALAL CHICKEN THIGH|BEEF EYE|BEEF GROUND 78|BEEF GROUND PTY|' +
  '^WHITEFISH|TUNA CHUNK|PUMPKIN SEED|SUNFLOWER KERNEL|PIST RST|WATER SPRING SPORT|WATER SPRING SPRKLG REG');

// "Last Inventory Qty" looks like "2.00 CS/3.00 EA" — sum every number.
export function qtyTotal(s) {
  const nums = String(s == null ? '' : s).match(/-?\d+\.?\d*/g);
  return nums ? nums.reduce((a, x) => a + parseFloat(x), 0) : 0;
}

// Why an item is out of audit scope, or null if it should be audited.
// `clsTop` is the lowercased top-level classification segment.
export function scopeReason({ description, clsTop, category, qty }) {
  const D = description.toUpperCase();
  const guarded = FOOD_GUARD.test(D);
  const nonFoodRoom = clsTop.startsWith('paper') || clsTop.startsWith('chemical') || clsTop.startsWith('cleaning');
  if ((nonFoodRoom || NONFOOD_CATS.has(String(category).toUpperCase()) || NON_FOOD.test(D)) && !guarded) {
    return 'non_food';
  }
  if (clsTop.startsWith('do not invent')) return 'do_not_inventory'; // incl. "INVENTROY" typo
  // qty === null means the file has no quantity column — don't zero-exclude.
  if (qty !== null && qty === 0) return 'zero_qty';
  if (clsTop === 'produce walk-in') return 'single_ingredient';
  if (SINGLE.test(D) && !SINGLE_KEEP.test(D)) return 'single_ingredient';
  return null;
}
