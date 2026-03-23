import { GoogleGenAI } from '@google/genai';
try {
  const ai = new GoogleGenAI({ apiKey: 'test' });
  console.log('Success');
} catch (e) {
  console.error(e.name + ': ' + e.message);
}
