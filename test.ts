import cities from './us-cities.json';
const common = ['a', 'an', 'the', 'is', 'are', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under', 'around', 'among', 'and', 'or', 'but', 'if', 'because', 'until', 'while', 'above', 'below', 'from', 'up', 'down', 'off', 'again', 'further', 'then', 'once', 'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'don', 'should', 'now'];
const found = cities.filter((c: string) => common.includes(c.toLowerCase()));
console.log(found);
