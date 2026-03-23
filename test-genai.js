import { GoogleGenAI } from '@google/genai';
console.log(typeof GoogleGenAI);
try {
  new GoogleGenAI({ apiKey: 'test' });
  console.log('Success');
} catch (e) {
  console.error(e.name, e.message);
}
