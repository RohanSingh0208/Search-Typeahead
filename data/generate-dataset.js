/**
 * Synthetic dataset generator for the Search Typeahead System.
 * Generates 100K+ realistic search queries with Zipf-distributed counts.
 * Output: data/queries.csv (query,count)
 */

const fs = require('fs');
const path = require('path');

// ─── Category Templates ───────────────────────────────────────────────────────

const categories = {
  tech: {
    weight: 15,
    templates: [
      '{brand} {product} review',
      'best {product} 2024',
      'how to use {product}',
      '{product} vs {product2}',
      '{brand} {product} price',
      '{product} tutorial',
      '{brand} {product} specs',
      'how to fix {product}',
      '{product} not working',
      '{product} update',
      '{lang} {concept} example',
      'learn {lang} programming',
      '{framework} vs {framework2}',
      'how to install {software}',
      '{software} download',
      '{concept} explained',
      'best {software} for {task}',
      '{product} setup guide',
    ],
    vars: {
      brand: ['apple', 'samsung', 'google', 'microsoft', 'sony', 'lg', 'dell', 'hp', 'lenovo', 'asus', 'nvidia', 'amd', 'intel'],
      product: ['laptop', 'phone', 'tablet', 'macbook', 'iphone', 'galaxy', 'pixel', 'ipad', 'airpods', 'headphones', 'keyboard', 'monitor', 'mouse', 'webcam', 'gpu', 'cpu', 'ssd', 'ram', 'router', 'smartwatch'],
      product2: ['laptop', 'phone', 'tablet', 'macbook', 'iphone', 'galaxy', 'pixel', 'ipad'],
      lang: ['python', 'javascript', 'java', 'typescript', 'rust', 'go', 'kotlin', 'swift', 'react', 'node', 'sql'],
      framework: ['react', 'vue', 'angular', 'nextjs', 'svelte', 'django', 'flask', 'fastapi', 'spring', 'express'],
      framework2: ['react', 'vue', 'angular', 'nextjs', 'svelte', 'django', 'flask'],
      concept: ['api', 'database', 'machine learning', 'neural network', 'docker', 'kubernetes', 'microservices', 'rest api', 'graphql', 'websocket'],
      software: ['vscode', 'docker', 'git', 'nodejs', 'python', 'chrome', 'firefox', 'zoom', 'slack', 'figma', 'photoshop'],
      task: ['coding', 'design', 'video editing', 'gaming', 'office work', 'web development'],
    },
  },

  shopping: {
    weight: 20,
    templates: [
      'buy {item} online',
      'cheap {item}',
      'best {item} under {price}',
      '{item} sale',
      '{item} discount',
      'where to buy {item}',
      '{item} deals',
      '{brand} {item}',
      '{item} free shipping',
      'top rated {item}',
      '{item} review',
      'best {item} for {use}',
    ],
    vars: {
      item: ['shoes', 'bag', 'watch', 'jacket', 'dress', 'sofa', 'chair', 'desk', 'bed', 'mattress', 'pillow', 'lamp', 'kitchen set', 'blender', 'coffee maker', 'air fryer', 'vacuum cleaner', 'headphones', 'earbuds', 'camera', 'printer', 'charger', 'case', 'wallet', 'sunglasses'],
      brand: ['nike', 'adidas', 'puma', 'gucci', 'zara', 'h&m', 'ikea', 'amazon basics', 'anker', 'jbl', 'sony', 'samsung'],
      price: ['50', '100', '200', '500', '1000'],
      use: ['home', 'office', 'travel', 'gym', 'outdoor', 'gaming'],
    },
  },

  entertainment: {
    weight: 18,
    templates: [
      '{title} movie',
      '{title} series',
      'watch {title} online',
      '{title} streaming',
      '{title} download',
      'best {genre} movies',
      'top {genre} series 2024',
      '{title} review',
      '{title} cast',
      '{artist} songs',
      '{artist} new album',
      '{artist} concert',
      'best {genre} music',
      '{game} gameplay',
      'how to play {game}',
      '{game} tips',
      '{game} cheats',
      '{game} review',
      'best {platform} games',
    ],
    vars: {
      title: ['stranger things', 'the bear', 'oppenheimer', 'dune', 'inception', 'interstellar', 'the batman', 'avengers', 'spider-man', 'the crown', 'wednesday', 'squid game', 'breaking bad', 'game of thrones', 'the witcher', 'peaky blinders', 'money heist'],
      genre: ['action', 'comedy', 'horror', 'thriller', 'sci-fi', 'romance', 'documentary', 'anime', 'fantasy', 'drama', 'crime'],
      artist: ['taylor swift', 'drake', 'ed sheeran', 'billie eilish', 'the weeknd', 'olivia rodrigo', 'bad bunny', 'ariana grande', 'post malone', 'eminem', 'coldplay', 'beyonce'],
      game: ['minecraft', 'fortnite', 'gta 5', 'valorant', 'elden ring', 'call of duty', 'fifa 24', 'apex legends', 'roblox', 'league of legends', 'zelda', 'pokemon'],
      platform: ['ps5', 'xbox', 'pc', 'nintendo switch', 'mobile'],
    },
  },

  food: {
    weight: 12,
    templates: [
      '{dish} recipe',
      'how to make {dish}',
      'easy {dish} recipe',
      'best {dish} near me',
      '{cuisine} food near me',
      'healthy {dish} recipe',
      '{ingredient} substitute',
      'how long to cook {dish}',
      '{dish} calories',
      'vegan {dish} recipe',
      '{diet} meal plan',
    ],
    vars: {
      dish: ['pasta', 'pizza', 'chicken', 'steak', 'sushi', 'ramen', 'burger', 'salad', 'soup', 'cake', 'cookies', 'bread', 'rice', 'noodles', 'tacos', 'curry', 'stir fry', 'omelette', 'pancakes', 'smoothie'],
      cuisine: ['italian', 'chinese', 'japanese', 'mexican', 'indian', 'thai', 'french', 'greek', 'korean', 'mediterranean'],
      ingredient: ['eggs', 'butter', 'flour', 'milk', 'cream', 'garlic', 'onion', 'tomato', 'lemon', 'cheese'],
      diet: ['keto', 'vegan', 'paleo', 'mediterranean', 'intermittent fasting', 'low carb'],
    },
  },

  health: {
    weight: 10,
    templates: [
      '{symptom} symptoms',
      'how to treat {condition}',
      '{condition} causes',
      'best exercises for {goal}',
      'how to lose weight fast',
      '{supplement} benefits',
      '{supplement} side effects',
      'mental health tips',
      'how to sleep better',
      'best diet for {goal}',
      'how to reduce {symptom}',
    ],
    vars: {
      symptom: ['headache', 'back pain', 'anxiety', 'fatigue', 'stress', 'insomnia', 'nausea', 'depression'],
      condition: ['diabetes', 'hypertension', 'asthma', 'arthritis', 'migraine', 'eczema', 'anxiety disorder'],
      goal: ['weight loss', 'muscle gain', 'better sleep', 'more energy', 'stress relief', 'flexibility'],
      supplement: ['vitamin d', 'omega 3', 'magnesium', 'protein powder', 'creatine', 'melatonin', 'zinc', 'vitamin c'],
    },
  },

  education: {
    weight: 10,
    templates: [
      'how to learn {subject}',
      '{subject} for beginners',
      '{subject} online course',
      '{subject} certification',
      'best {subject} books',
      '{exam} preparation',
      'how to pass {exam}',
      '{concept} definition',
      '{concept} explained simply',
      'difference between {a} and {b}',
    ],
    vars: {
      subject: ['data science', 'machine learning', 'web development', 'graphic design', 'photography', 'finance', 'accounting', 'marketing', 'english', 'spanish', 'french', 'piano', 'guitar', 'drawing'],
      exam: ['ielts', 'gmat', 'gre', 'toefl', 'sat', 'cat', 'gate', 'upsc', 'neet', 'jee'],
      concept: ['photosynthesis', 'inflation', 'democracy', 'quantum physics', 'relativity', 'evolution', 'supply and demand'],
      a: ['machine learning', 'ai', 'deep learning', 'sql', 'data science'],
      b: ['deep learning', 'ml', 'neural networks', 'nosql', 'data analytics'],
    },
  },

  travel: {
    weight: 8,
    templates: [
      '{city} tourist attractions',
      'things to do in {city}',
      '{city} travel guide',
      'best time to visit {country}',
      '{country} visa requirements',
      'cheap flights to {city}',
      '{city} hotels',
      'airbnb {city}',
      '{country} travel tips',
      'budget travel {country}',
    ],
    vars: {
      city: ['paris', 'tokyo', 'new york', 'london', 'dubai', 'bali', 'rome', 'barcelona', 'amsterdam', 'istanbul', 'singapore', 'bangkok', 'sydney', 'toronto', 'berlin', 'lisbon', 'prague', 'vienna', 'seoul', 'mumbai'],
      country: ['japan', 'france', 'usa', 'italy', 'thailand', 'australia', 'spain', 'germany', 'india', 'indonesia', 'turkey', 'greece', 'portugal', 'canada', 'uk'],
    },
  },

  finance: {
    weight: 7,
    templates: [
      'how to invest in {asset}',
      '{asset} price today',
      'best {asset} to buy 2024',
      'how to save money',
      '{bank} account opening',
      '{service} review',
      'best credit card for {benefit}',
      'how to get {document}',
      '{topic} for beginners',
      'how to file {doc}',
    ],
    vars: {
      asset: ['stocks', 'bitcoin', 'ethereum', 'gold', 'real estate', 'mutual funds', 'etf', 'nifty 50', 'us stocks', 'index funds'],
      bank: ['hdfc', 'icici', 'sbi', 'chase', 'bank of america', 'wells fargo', 'paytm', 'gpay'],
      service: ['zerodha', 'groww', 'robinhood', 'coinbase', 'binance', 'paypal', 'wise'],
      benefit: ['cashback', 'travel', 'fuel', 'shopping', 'lounge access'],
      document: ['passport', 'visa', 'pan card', 'aadhar', 'driving license'],
      doc: ['income tax', 'gst', 'itr'],
      topic: ['investing', 'stock market', 'cryptocurrency', 'personal finance', 'insurance'],
    },
  },
};

// ─── Zipf Distribution ────────────────────────────────────────────────────────

function zipfCount(rank, total, maxCount = 50000) {
  // Zipf: count ∝ 1/rank^s, s ≈ 1.2
  const s = 1.2;
  return Math.max(1, Math.round(maxCount / Math.pow(rank, s)));
}

// ─── Template Expansion ───────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function expandTemplate(template, vars) {
  let result = template;
  const usedKeys = new Set();

  // Replace each {placeholder} with a random value from vars
  result = result.replace(/\{(\w+)\}/g, (_, key) => {
    if (!vars[key]) return key;
    // For duplicate keys like {product} and {product2}, strip the digit suffix
    const baseKey = key.replace(/\d+$/, '');
    if (!vars[baseKey]) return key;
    const val = pick(vars[baseKey]);
    usedKeys.add(key);
    return val;
  });

  return result;
}

function generateQueries() {
  const queries = new Map(); // query -> count
  let rank = 1;

  const modifiers = [
    '2021', '2022', '2023', '2024', 'review', 'guide', 'price', 'online',
    'near me', 'best', 'cheap', 'free', 'reddit', 'forum', 'alternative',
    'tips', 'tricks', 'tutorial', 'pdf', 'download', 'vs', 'for beginners',
    'advanced', 'pro', 'max', 'plus', 'ultra', 'mini', 'sale', 'discount',
    'deals', 'setup', 'specs', 'update', 'fix', 'error', 'help', 'support'
  ];

  const categoryKeys = Object.keys(categories);
  const totalWeight = categoryKeys.reduce((s, k) => s + categories[k].weight, 0);

  function pickCategory() {
    let r = Math.random() * totalWeight;
    for (const key of categoryKeys) {
      if (r < categories[key].weight) return categories[key];
      r -= categories[key].weight;
    }
    return categories[categoryKeys[0]];
  }

  // Generate exactly 100,000 unique queries
  while (queries.size < 100000) {
    const cat = pickCategory();
    const template = pick(cat.templates);
    let query = expandTemplate(template, cat.vars);

    // Randomly append 1 or 2 modifiers to massively increase uniqueness
    if (Math.random() < 0.8) {
      query += ' ' + pick(modifiers);
      if (Math.random() < 0.4) {
        query += ' ' + pick(modifiers);
      }
    }

    if (!queries.has(query)) {
      const count = zipfCount(rank, 100000, 500000); // Higher max count for better zipf spread
      queries.set(query, count);
      rank++;
    }
  }

  // Overwrite some top queries with very popular single words
  const hotQueries = [
    'google', 'youtube', 'facebook', 'instagram', 'twitter', 'amazon', 'netflix', 'whatsapp',
    'weather', 'news', 'maps', 'translate', 'calculator', 'gmail', 'photos', 'drive',
    'iphone', 'samsung', 'laptop', 'shoes', 'recipe', 'movie', 'music', 'game',
    'covid', 'vaccine', 'election', 'football', 'cricket', 'nba', 'worldcup',
  ];
  
  hotQueries.forEach((q, i) => {
    // Re-assign high counts to these specific queries
    queries.set(q, zipfCount(i + 1, hotQueries.length, 1000000));
  });

  return queries;
}

// ─── Write CSV ────────────────────────────────────────────────────────────────

function main() {
  console.log('🔄 Generating synthetic dataset...');
  const startTime = Date.now();

  const queries = generateQueries();

  // Sort by count descending and re-rank
  const sorted = [...queries.entries()].sort((a, b) => b[1] - a[1]);

  const outDir = path.join(__dirname);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, 'queries.csv');
  const lines = ['query,count', ...sorted.map(([q, c]) => `"${q.replace(/"/g, '""')}",${c}`)];
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  const elapsed = Date.now() - startTime;
  console.log(`✅ Generated ${sorted.length.toLocaleString()} unique queries → ${outPath}`);
  console.log(`   Top 5: ${sorted.slice(0, 5).map(([q, c]) => `"${q}" (${c})`).join(', ')}`);
  console.log(`   Time: ${elapsed}ms`);
}

main();
