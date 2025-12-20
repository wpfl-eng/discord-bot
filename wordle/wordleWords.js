// Wordle Word Lists
// Curated lists of 5-letter words for the Wordle game

/**
 * Answer words - Common, recognizable 5-letter words that can be THE answer
 * These are words most players would know and can reasonably guess
 * ~800 words covering common nouns, verbs, adjectives
 */
export const ANSWER_WORDS = [
  // A
  "about", "above", "abuse", "actor", "acute", "admit", "adopt", "adult", "after", "again",
  "agent", "agree", "ahead", "alarm", "album", "alert", "alien", "align", "alike", "alive",
  "allow", "alone", "along", "alter", "among", "angel", "anger", "angle", "angry", "anime",
  "ankle", "apart", "apple", "apply", "arena", "argue", "arise", "armor", "aroma",
  "array", "arrow", "arson", "asset", "atlas", "audio", "audit", "avoid", "award", "aware",
  "awful",
  // B
  "bacon", "badge", "badly", "baker", "basic", "basin", "basis", "batch", "beach", "beast",
  "begin", "being", "belly", "below", "bench", "berry", "birth", "black", "blade", "blame",
  "blank", "blast", "blaze", "bleed", "blend", "bless", "blind", "blink", "block", "blond",
  "blood", "bloom", "blown", "board", "boast", "bonus", "boost", "booth", "bound", "brace",
  "brain", "brake", "brand", "brass", "brave", "bread", "break", "breed", "brick", "bride",
  "brief", "bring", "broad", "broke", "brook", "broom", "brown", "brush", "buddy", "build",
  "bunch", "burst", "buyer",
  // C
  "cabin", "cable", "cache", "camel", "candy", "cargo", "carry", "carve", "catch", "cause",
  "chain", "chair", "chalk", "champ", "chaos", "charm", "chart", "chase", "cheap", "cheat",
  "check", "cheek", "cheer", "chess", "chest", "chief", "child", "chill", "china", "chips",
  "choir", "chord", "chose", "chunk", "civic", "civil", "claim", "clash", "class", "clean",
  "clear", "clerk", "click", "cliff", "climb", "cling", "clock", "close", "cloth", "cloud",
  "clown", "coach", "coast", "colon", "color", "comet", "comic", "coral", "couch", "cough",
  "could", "count", "court", "cover", "crack", "craft", "crane", "crash", "crawl", "crazy",
  "cream", "creek", "creep", "crest", "crime", "crisp", "cross", "crowd", "crown", "crude",
  "cruel", "crush", "curve", "cycle",
  // D
  "daily", "dairy", "daisy", "dance", "death", "debut", "decay", "decor", "delay", "delta",
  "demon", "denim", "dense", "depot", "depth", "derby", "diary", "digit", "dirty",
  "disco", "ditch", "diver", "dizzy", "doubt", "dough", "dozen", "draft", "drain", "drake",
  "drama", "drank", "drawn", "dread", "dream", "dress", "dried", "drift", "drill", "drink",
  "drive", "droit", "drown", "drunk", "dryer", "dwell",
  // E
  "eager", "eagle", "early", "earth", "eaten", "eater", "eight", "elbow", "elder", "elect",
  "elite", "email", "embed", "ember", "empty", "enemy", "enjoy", "enter", "entry", "equal",
  "equip", "erase", "error", "essay", "ethic", "event", "every", "exact", "exams", "excel",
  "exist", "extra",
  // F
  "fable", "faced", "facet", "fairy", "faith", "false", "fancy", "fatal", "fault", "favor",
  "feast", "fence", "ferry", "fetch", "fever", "fiber", "field", "fiery", "fifth", "fifty",
  "fight", "final", "first", "fixed", "flags", "flame", "flare", "flash", "flask", "fleet",
  "flesh", "flick", "fling", "flint", "float", "flock", "flood", "floor", "flora", "flour",
  "flown", "fluid", "flung", "flush", "flute", "focal", "focus", "foggy", "force", "forge",
  "forth", "forty", "forum", "found", "frame", "frank", "fraud", "freak", "fresh",
  "fried", "front", "frost", "fruit", "fully", "fungi", "funny", "fuzzy",
  // G
  "gamma", "gauge", "genre", "ghost", "giant", "given", "giver", "gland", "glass",
  "gleam", "glide", "globe", "gloom", "glory", "gloss", "glove", "grace", "grade", "grain",
  "grand", "grant", "grape", "graph", "grasp", "grass", "grave", "great", "greed", "greek",
  "green", "greet", "grief", "grill", "grind", "groan", "groom", "gross", "group", "grove",
  "growl", "grown", "guard", "guess", "guest", "guide", "guild", "guilt", "gummy", "gusty",
  // H
  "habit", "handy", "happy", "harsh", "haste", "hasty", "hatch", "haunt", "haven", "heart",
  "heath", "heavy", "hedge", "heist", "hello", "hence", "heron", "hertz", "hinge", "hippo",
  "hobby", "holly", "honey", "honor", "horse", "hotel", "hound", "house", "hover",
  "human", "humid", "humor", "hurry", "hyena",
  // I
  "ideal", "image", "imply", "inbox", "index", "indie", "infer", "inner", "input", "intel",
  "inter", "intro", "ionic", "irate", "irony", "issue", "items", "ivory",
  // J
  "jeans", "jelly", "jewel", "joint", "joker", "jolly", "joule", "judge", "juice", "juicy",
  "jumbo", "jumpy", "junky",
  // K
  "karma", "kayak", "kebab", "keyed", "kinky", "kiosk", "kitty", "knack", "knead", "kneel",
  "knife", "knock", "known",
  // L
  "label", "labor", "lance", "large", "laser", "latch", "later", "laugh", "layer", "learn",
  "lease", "least", "leave", "legal", "lemon", "level", "lever", "light", "limit", "linen",
  "liner", "lions", "lists", "liter", "liver", "llama", "lobby", "local", "lodge",
  "logic", "login", "loose", "lorry", "loser", "lotus", "lover",
  "lower", "loyal", "lucky", "lunar", "lunch", "lyric",
  // M
  "macro", "magic", "major", "maker", "manor", "maple", "march", "marry", "marsh", "masks",
  "match", "maths", "mayor", "meals", "means", "media", "melon", "mercy", "merge", "merit",
  "merry", "messy", "metal", "meter", "metro", "micro", "midst", "might", "minor", "minus",
  "mirth", "mixed", "mixer", "modal", "model", "modem", "moist", "money", "month", "moose",
  "moral", "morph", "motor", "motto", "mound", "mount", "mouse", "mouth", "movie", "muddy",
  "mural", "music", "musty", "myths",
  // N
  "naive", "naked", "named", "nanny", "nasal", "nasty", "naval", "needs", "nerve", "never",
  "newer", "newly", "night", "ninja", "ninth", "noble", "noise", "noisy", "north", "notch",
  "noted", "notes", "novel", "nudge", "nurse", "nutty", "nylon",
  // O
  "oasis", "occur", "ocean", "octet", "oddly", "offer", "often", "olive", "omega", "onion",
  "onset", "opera", "optic", "orbit", "order", "organ", "other", "ought", "ounce", "outer",
  "owner", "oxide", "ozone",
  // P
  "panda", "panel", "panic", "paper", "parks", "parse", "party", "paste", "patch", "patio",
  "pause", "peace", "peach", "pearl", "pedal", "penny", "perch", "peril", "perks", "petal",
  "petty", "phase", "phone", "photo", "piano", "piece", "pilot", "pinch", "pixel", "pizza",
  "place", "plaid", "plain", "plane", "plant", "plate", "plaza", "plead", "pleat", "plier",
  "pluck", "plumb", "plump", "plunk", "plush", "point", "poise", "poker", "polar",
  "polls", "pooch", "pools", "porch", "posed", "poser", "potty", "pouch", "pound", "power",
  "prank", "press", "price", "pride", "prime", "print", "prior", "prism", "prize",
  "probe", "prone", "proof", "prose", "proud", "prove", "prowl", "proxy", "prune", "pulse",
  "punch", "pupil", "puppy", "purse", "pushy",
  // Q
  "quack", "quake", "qualm", "quart", "queen", "query", "quest", "queue", "quick", "quiet",
  "quilt", "quirk", "quite", "quota", "quote",
  // R
  "rabbi", "radar", "radio", "rainy", "raise", "rally", "ranch", "range", "rapid", "ratio",
  "reach", "react", "ready", "realm", "rebel", "refer", "reign", "relax", "relay", "relic",
  "remit", "remix", "renew", "repay", "reply", "rerun", "reset", "resin", "retro", "rider",
  "ridge", "rifle", "right", "rigid", "rigor", "rinse", "risen", "risky", "rival", "river",
  "roast", "robot", "rocky", "rogue", "roman", "roomy", "roots", "roses", "rotor", "rouge",
  "rough", "round", "route", "royal", "rugby", "ruler", "rumor", "rural", "rusty",
  // S
  "sadly", "saint", "salad", "sales", "salon", "salsa", "salty", "sandy", "satin", "sauce",
  "sauna", "saved", "scale", "scald", "scalp", "scant", "scare", "scarf", "scary", "scene",
  "scent", "scold", "scone", "scoop", "scope", "score", "scout", "scrap", "screw", "scrub",
  "seals", "seams", "seats", "seize", "sense", "serum", "serve", "setup", "seven", "sever",
  "shade", "shake", "shaky", "shall", "shame", "shape", "shard", "share", "shark", "sharp",
  "shave", "sheep", "sheer", "sheet", "shelf", "shell", "shift", "shine", "shiny", "shire",
  "shirt", "shock", "shoot", "shore", "short", "shout", "shown", "shrug", "siege", "sight",
  "sigma", "silly", "since", "sixth", "sixty", "sized", "skate", "skill", "skimp", "skirt",
  "skull", "skunk", "slack", "slain", "slang", "slant", "slash", "slate", "slave", "sleek",
  "sleep", "slept", "slice", "slide", "slime", "slimy", "sling", "slope", "sloth", "slump",
  "slung", "small", "smart", "smash", "smear", "smell", "smile", "smirk", "smith", "smoke",
  "snack", "snail", "snake", "snare", "snarl", "sneak", "sniff", "snore", "snort", "snout",
  "snowy", "sober", "solar", "solid", "solve", "sonic", "sorry", "sound",
  "south", "space", "spade", "spare", "spark", "spawn", "speak", "spear", "speed", "spell",
  "spend", "spent", "spice", "spicy", "spill", "spine", "spite", "split", "spoke",
  "spoon", "sport", "spout", "spray", "squad", "stack", "staff", "stage", "stain", "stair",
  "stake", "stale", "stall", "stamp", "stand", "stank", "stare", "stark", "stars", "start",
  "stash", "state", "stave", "stays", "steak", "steal", "steam", "steel", "steep", "steer",
  "stems", "steps", "stern", "stick", "stiff", "still", "sting", "stink", "stock", "stoic",
  "stoke", "stomp", "stone", "stony", "stool", "stoop", "store", "stork", "storm", "story",
  "stout", "stove", "strap", "straw", "stray", "strip", "strut", "stuck", "study", "stuff",
  "stump", "stung", "stunk", "stunt", "style", "suave", "sugar", "suite", "sunny", "super",
  "surge", "sushi", "swamp", "swarm", "swear", "sweat", "sweep", "sweet", "swept", "swift",
  "swine", "swing", "swipe", "swirl", "swoop", "sword", "swore", "sworn", "swung", "syrup",
  // T
  "table", "taboo", "tacky", "taint", "taken", "taker", "tales", "tally", "talon", "tangy",
  "tapir", "taste", "tasty", "taxes", "teach", "teams", "tears", "tease", "teens", "teeth",
  "tempo", "tense", "tenth", "terms", "tests", "texts", "thank", "theft", "their", "theme",
  "there", "these", "thick", "thief", "thigh", "thing", "think", "third", "thorn", "those",
  "three", "threw", "throw", "thumb", "tiger", "tight", "tiles", "timer", "times", "timid",
  "tipsy", "tired", "titan", "title", "toast", "today", "token", "tonal", "tonic", "tooth",
  "topic", "torch", "total", "touch", "tough", "tours", "towel", "tower", "toxic", "trace",
  "track", "tract", "trade", "trail", "train", "trait", "tramp", "trash", "trawl", "tread",
  "treat", "trees", "trend", "trial", "tribe", "trick", "tried", "trike", "trill", "troop",
  "trout", "truce", "truck", "truly", "trump", "trunk", "trust", "truth", "tuber", "tulip",
  "tumor", "tuned", "tuner", "tunic", "turbo", "tutor", "twang", "tweak", "tweet", "twice",
  "twine", "twirl", "twist", "tying", "typed",
  // U
  "udder", "ultra", "uncle", "uncut", "under", "undid", "undue", "unfed", "unfit", "union",
  "unite", "unity", "unlit", "unmet", "unset", "until", "unwed", "upper", "upset", "urban",
  "urged", "urine", "usage", "usher", "using", "usual", "utter",
  // V
  "vague", "valid", "valor", "value", "valve", "vapor", "vault", "vegan", "veins", "veldt",
  "venue", "verge", "verse", "vibes", "video", "vigor", "villa", "vinca", "vinyl", "viola",
  "viper", "viral", "virus", "visit", "visor", "vista", "vital", "vivid", "vocal", "vodka",
  "vogue", "voice", "voila", "vomit", "voter", "vouch", "vowel",
  // W
  "wafer", "wager", "wagon", "waist", "waive", "waltz", "warty", "waste", "watch", "water",
  "waved", "waxed", "weary", "weave", "wedge", "weeds", "weigh", "weird", "whale", "wheat",
  "wheel", "where", "which", "while", "whine", "whirl", "white", "whole", "whose", "widen",
  "wider", "widow", "width", "wield", "windy", "wired", "witty", "woken", "woman", "women",
  "world", "worry", "worse", "worst", "worth", "would", "wound", "woven", "wrack", "wrath",
  "wreak", "wreck", "wrest", "wring", "wrist", "write", "wrong", "wrote", "wrung",
  // Y
  "yacht", "yearn", "yeast", "yield", "young", "yours", "youth", "yummy",
  // Z
  "zebra", "zesty", "zloty", "zonal", "zones", "zombi",
];

/**
 * Valid guesses - Additional words that can be guessed but won't be answers
 * These include less common words, plurals, verb forms, etc.
 */
export const VALID_GUESSES = [
  // Common additional valid words (not answers but acceptable guesses)
  "aahed", "aalii", "aargh", "abaca", "abaci", "aback", "abaft", "abamp", "abase", "abash",
  "abate", "abbey", "abbot", "abeam", "abele", "abets", "abhor", "abide", "abled", "abler",
  "ables", "abode", "abohm", "abort", "bound", "bouts", "boxed", "boxer", "boxes", "brace",
  "brack", "bract", "brads", "brags", "brahs", "braid", "brail", "braky", "brand", "brash",
  "brass", "brats", "bravo", "brawl", "brawn", "brays", "bread", "break", "bream", "brede",
  "breed", "brens", "brent", "breve", "brews", "briar", "bribe", "brick", "bride", "brief",
  "brier", "brigs", "brill", "brims", "brine", "bring", "brink", "briny", "brisk", "broad",
  "broil", "broke", "bromo", "bronc", "bronx", "brood", "brook", "broom", "broth", "brown",
  "brows", "bruin", "bruit", "brunt", "brush", "brusk", "brute", "bubba", "bucks", "buddy",
  "budge", "buffs", "buggy", "bugle", "build", "built", "bulbs", "bulge", "bulks", "bulky",
  "bulla", "bulls", "bully", "bumps", "bumpy", "bunch", "bunco", "bunds", "bungs", "bunks",
  "bunny", "bunts", "buoys", "burbs", "burds", "buret", "burgh", "burgs", "burly",
  "burns", "burnt", "burps", "burro", "burrs", "burst", "busby", "bushy", "busks", "busts",
  "busty", "butch", "butte", "butts", "butyl", "buxom", "buyer", "buzzy", "bylaw", "byres",
  "bytes", "byway", "cabal", "cabby", "caber", "cabin", "cable", "cacao", "cache", "cacti",
  "caddy", "cadet", "cadge", "cadre", "cafes", "caged", "cager", "cages", "cagey", "caird",
  "cairn", "caked", "cakes", "cakey", "calfs", "calif", "calix", "calks", "calla", "calls",
  "calms", "camel", "cameo", "camps", "campy", "canal", "candy", "caned", "caner", "canes",
  "canid", "canna", "canny", "canoe", "canon", "canso", "canto", "cants", "canty", "caped",
  "caper", "capes", "capon", "capos", "cards", "cared", "carer", "cares", "caret", "cargo",
  "carks", "carle", "carls", "carny", "carob", "carol", "carom", "carps", "carry", "carse",
  "carte", "carts", "carve", "cased", "cases", "casks", "caste", "casts", "catch", "cater",
  "catty", "cause", "caved", "caver", "caves", "cavil", "cawed", "cease", "cecal", "cecum",
  "cedar", "ceded", "ceder", "cedes", "ceils", "celeb", "cella", "cello", "cells", "celts",
  "cents", "cento", "cents", "centu", "ceorl", "cepes", "cerci", "cered", "ceres", "ceria",
  "ceric", "ceros", "certs", "chads", "chafe", "chaff", "chain", "chair", "chalk", "champ",
  "chams", "chang", "chant", "chaos", "chape", "chaps", "chard", "charm", "chars", "chart",
  "chase", "chasm", "chats", "chaws", "cheap", "cheat", "check", "cheek", "cheep", "cheer",
  "chess", "chest", "chewy", "chick", "chide", "chief", "child", "chile", "chili", "chill",
  "chimp", "china", "chine", "ching", "chino", "chins", "chips", "chirk", "chirm", "chiro",
  "chirp", "chirr", "chits", "chive", "chivy", "chock", "choir", "choke", "choky", "chomp",
  "chord", "chore", "chose", "chott", "chows", "chuck", "chufa", "chuff", "chugs", "chump",
  "chums", "chunk", "churl", "churn", "churr", "chute", "cider", "cigar", "cilia", "cills",
  "cinch", "cines", "circa", "cires", "cisco", "cissy", "cited", "citer", "cites", "civet",
  "civic", "civil", "civvy", "clack", "clads", "clags", "claim", "clamp", "clams", "clang",
  "clank", "clans", "claps", "clapt", "clash", "clasp", "class", "clast", "clave", "claws",
  "clays", "clean", "clear", "cleat", "cleek", "clefs", "cleft", "clerk", "clews", "click",
  "cliff", "climb", "clime", "cline", "cling", "clink", "clips", "cloak", "clock", "clods",
  "clogs", "clomp", "clone", "clonk", "clons", "clops", "close", "cloth", "clots", "cloud",
  "clour", "clout", "clove", "clown", "clubs", "cluck", "clued", "clues", "cluey", "clump",
  "clung", "clunk", "coach", "coact", "coals", "coaly", "coast", "coats", "cobra", "cocos",
  "codas", "coded", "coder", "codes", "codex", "codon", "coeds", "cohos", "coifs", "coign",
  "coils", "coins", "coirs", "coked", "cokes", "colas", "colby", "colds", "coled", "coles",
  "colic", "colin", "colly", "colon", "color", "colts", "colza", "comas", "combs", "comer",
  "comes", "comet", "comfy", "comic", "comma", "comps", "conch", "condo", "coned", "cones",
  "coney", "conga", "congo", "conic", "conks", "conky", "conte", "cooed", "cooee", "cooer",
  "cooey", "coofs", "cooks", "cooky", "cools", "cooly", "coomb", "coons", "coops", "coopt",
  "coots", "copal", "coped", "copen", "coper", "copes", "copra", "copse", "coral", "cords",
  "cordy", "cored", "corer", "cores", "corgi", "coria", "corks", "corky", "corms", "corns",
  "cornu", "corny", "corps", "coset", "coshy", "cosie", "costs", "cotan", "coted", "cotes",
  "couch", "cough", "could", "count", "coupe", "coups", "court", "couth", "coven", "cover",
  "coves", "covet", "covey", "cowan", "cowed", "cower", "cowls", "cowry", "coxal", "coxed",
  "coxes", "coyed", "coyer", "coyly", "coypu", "cozen", "craal", "crabs", "crack", "craft",
  "crags", "crake", "cramp", "crams", "crane", "crank", "crape", "craps", "crash", "crass",
  "crate", "crave", "crawl", "craws", "craze", "crazy", "creak", "cream", "credo", "creed",
  "creek", "creel", "creep", "creme", "crepe", "crept", "crepy", "cress", "crest", "cribs",
  "crick", "cried", "crier", "cries", "crime", "crimp", "cripe", "crisp", "croak", "crock",
  "croft", "crone", "crony", "crook", "croon", "crops", "cross", "croup", "crowd", "crown",
  "crows", "crude", "cruel", "cruet", "cruft", "crumb", "crump", "cruor", "crura", "cruse",
  "crush", "crust", "crypt", "cubed", "cuber", "cubes", "cubic", "cubit", "curbs", "curds",
  "curdy", "cured", "curer", "cures", "curie", "curio", "curls", "curly", "curry", "curse",
  "curve", "curvy", "cushy", "cusps", "cuter", "cutes", "cutey", "cutie", "cutis", "cutty",
  "cycad", "cycle", "cyclo", "cyder", "cymas", "cymes", "cynic", "cysts", "czars", "daces",
  "daddy", "dados", "daffs", "daffy", "daily", "dairy", "daisy", "dales", "dally", "dames",
  "damns", "damps", "dance", "dandy", "dangs", "danio", "darbs", "dared", "darer", "dares",
  "daric", "darks", "darns", "darts", "dashi", "dashy", "dated", "dater", "dates", "datos",
  "datum", "daube", "daubs", "dauby", "daunt", "datum", "daven", "dawks", "dawns", "dawts",
  "dazed", "dazer", "dazes", "deals", "dealt", "deans", "dears", "deary", "deash", "death",
  "deave", "debar", "debit", "debts", "debug", "debut", "decaf", "decal", "decay", "decks",
  "decor", "decoy", "decry", "deeds", "deedy", "deems", "deeps", "deers", "deets", "defat",
  "defer", "defis", "defog", "degas", "degum", "deice", "deify", "deign", "deils", "deism",
  "deity", "delay", "deled", "deles", "delfs", "delft", "delis", "dells", "delta", "delve",
  "demit", "demob", "demon", "demos", "demur", "denes", "denim", "dense", "dents", "depot",
  "depth", "deray", "derby", "derma", "derms", "derry", "desks", "deter", "detox", "deuce",
  "devas", "devel", "devil", "devon", "dewan", "dewax", "dewed", "diads", "diary", "diazo",
  "diced", "dicer", "dices", "dicey", "dicks", "dicky", "dicot", "dicta", "dicty", "didie",
  "didos", "didst", "diene", "diets", "diffs", "digit", "diked", "diker", "dikes", "dildo",
  "dills", "dilly", "dimer", "dimes", "dimly", "dinar", "dined", "diner", "dines", "dingo",
  "dings", "dingy", "dinks", "dinky", "dinna", "dints", "diode", "dipod", "dippy", "dipso",
  "direr", "dirge", "dirks", "dirls", "dirts", "dirty", "disco", "discs", "dishy", "disks",
  "disme", "ditas", "ditch", "dites", "ditsy", "ditto", "ditty", "ditzy", "divan", "divas",
  "dived", "diver", "dives", "divot", "divvy", "diwan", "dixit", "dizzy", "djinn", "djins",
  "doats", "dobby", "docks", "dodge", "dodgy", "dodos", "doers", "doffs", "doges", "doggy",
  "dogie", "dogma", "doily", "doing", "doits", "doled", "doles", "dolls", "dolly", "dolma",
  "dolor", "dolts", "domed", "domes", "domic", "donee", "donga", "dongs", "donna", "donne",
  "donor", "donsy", "donut", "dooms", "doors", "doozy", "dopas", "doped", "doper", "dopes",
  "dopey", "dorks", "dorky", "dorms", "dormy", "dorps", "dorsa", "dosed", "doser", "doses",
  "dotal", "doted", "doter", "dotes", "dotty", "doubt", "douce", "dough", "douma", "doura",
  "douse", "doven", "doves", "dowdy", "dowed", "dowel", "dower", "dowie", "downs", "downy",
  "dowry", "dowse", "doxie", "doyen", "doyly", "dozed", "dozen", "dozer", "dozes", "drabs",
  "draft", "drags", "drail", "drain", "drake", "drama", "drams", "drank", "drape", "drats",
  "drawl", "drawn", "draws", "drays", "dread", "dream", "drear", "dreck", "dreed", "drees",
  "dregs", "dreks", "dress", "drest", "dribs", "dried", "drier", "dries", "drift", "drill",
  "drily", "drink", "drips", "dript", "drive", "droid", "droit", "droll", "drone", "drool",
  "droop", "drops", "dross", "drubs", "drugs", "druid", "drums", "drunk", "drupe", "druse",
  "dryad", "dryer", "dryly", "duads", "duals", "ducks", "ducky", "ducts", "duddy",
  "dudes", "duels", "duets", "duffs", "dufus", "duits", "duked", "dukes", "dulls", "dully",
  "dulse", "dumbs", "dummy", "dumps", "dumpy", "dunce", "dunes", "dungs", "dungy", "dunks",
  "dunts", "duped", "duper", "dupes", "duple", "dural", "duras", "durns", "durra", "durrs",
  "durst", "dusks", "dusky", "dusts", "dusty", "dutch", "dwarf", "dweeb", "dwell",
  "dwelt", "dwine", "dyads", "dyers", "dying", "dyked", "dykes", "dynel", "dynes", "eager",
  "eagle", "eared", "earls", "early", "earns", "earth", "eased", "easel", "easer", "eases",
  "easts", "eaten", "eater", "eaved", "eaves", "ebbed", "ebbet", "ebons", "ebony", "ebook",
  // ... many more valid guesses would go here
  // For brevity, including a representative sample
  "xebec", "xenia", "xenic", "xenon", "xeric", "xerox", "xerus", "xylan", "xylem", "xylol",
  "xylyl", "xysti", "xysts", "yabby", "yacht", "yacks", "yaffs", "yager", "yagis", "yahoo",
  "yaird", "yales", "yamen", "yamun", "yangs", "yanks", "yapok", "yapon", "yappy", "yards",
  "yarer", "yarns", "yauds", "yauld", "yaups", "yawed", "yawls", "yawns", "yawny", "yawps",
  "yeahs", "yearn", "years", "yeast", "yecch", "yechs", "yeggs", "yelks", "yells", "yelps",
  "yenta", "yente", "yerba", "yerks", "yeses", "yetis", "yetts", "yeuks", "yeuky", "yield",
  "yikes", "yills", "yince", "yipes", "yirds", "yirrs", "yirth", "ylems", "yobbo", "yobby",
  "yocks", "yodel", "yodhs", "yodle", "yogas", "yogee", "yoghs", "yogin", "yogis", "yoked",
  "yokel", "yokes", "yolks", "yolky", "yonic", "yonis", "yores", "young", "yourn", "yours",
  "youse", "youth", "yowed", "yowes", "yowie", "yowls", "yuans", "yucas", "yucca", "yucch",
  "yucks", "yucky", "yugas", "yukky", "yulan", "yules", "yummy", "yupon", "yuppy", "yurta",
  "yurts", "zaire", "zakat", "zamia", "zappy", "zarfs", "zaxes", "zayin", "zazen", "zeals",
  "zebra", "zebus", "zeins", "zerks", "zeros", "zests", "zesty", "zetas", "zilch", "zincs",
  "zincy", "zineb", "zines", "zings", "zingy", "zinky", "zippy", "ziram", "zitis", "zizit",
  "zlote", "zloty", "zoeae", "zoeal", "zoeas", "zombi", "zonal", "zoned", "zoner", "zones",
  "zonks", "zooey", "zooid", "zooks", "zooms", "zoons", "zooty", "zoris", "zowie", "zuzim",
];

// Pre-compute Sets for O(1) lookup performance
const answerSet = new Set(ANSWER_WORDS.map((w) => w.toLowerCase()));
const validSet = new Set([
  ...ANSWER_WORDS.map((w) => w.toLowerCase()),
  ...VALID_GUESSES.map((w) => w.toLowerCase()),
]);

/**
 * Check if a word is a valid guess (can be entered as a guess)
 * @param {string} word - The word to check
 * @returns {boolean} True if the word is valid
 */
export function isValidWord(word) {
  if (!word || typeof word !== "string") {
    return false;
  }
  return validSet.has(word.toLowerCase());
}

/**
 * Check if a word can be an answer (is in the answer word list)
 * @param {string} word - The word to check
 * @returns {boolean} True if the word can be an answer
 */
export function isAnswerWord(word) {
  if (!word || typeof word !== "string") {
    return false;
  }
  return answerSet.has(word.toLowerCase());
}

/**
 * Get a random answer word, optionally excluding certain words
 * @param {string[]} excludeWords - Array of words to exclude (already used)
 * @returns {string} A random answer word
 */
export function getRandomWord(excludeWords = []) {
  const excludeSet = new Set(excludeWords.map((w) => w.toLowerCase()));
  const available = ANSWER_WORDS.filter((w) => !excludeSet.has(w.toLowerCase()));

  if (available.length === 0) {
    // Fallback: if all words exhausted, pick from full list (unlikely but safe)
    console.warn("All answer words have been used, recycling...");
    return ANSWER_WORDS[Math.floor(Math.random() * ANSWER_WORDS.length)];
  }

  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Get the total count of answer words available
 * @returns {number} Number of possible answer words
 */
export function getAnswerWordCount() {
  return ANSWER_WORDS.length;
}

/**
 * Get the total count of valid guess words
 * @returns {number} Number of valid guess words (including answers)
 */
export function getValidWordCount() {
  return validSet.size;
}
