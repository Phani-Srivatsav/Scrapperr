/**
 * Glaido Landing Page Logic
 */

'use strict';

const ARTICLES_PATH = '.tmp/articles.json';

// Generate starry background
function createStars() {
  const container = document.querySelector('.stars-container');
  if (!container) return;
  const count = 150;
  
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    
    // Random position
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    
    // Random size
    const size = Math.random() * 2 + 1;
    
    // Random duration for twinkle
    const duration = Math.random() * 3 + 2;
    
    star.style.left = `${x}%`;
    star.style.top = `${y}%`;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.setProperty('--duration', `${duration}s`);
    
    container.appendChild(star);
  }
}

// Fetch and populate marquee
async function initMarquee() {
  const marquee = document.getElementById('news-marquee');
  if (!marquee) return;
  
  try {
    const response = await fetch(ARTICLES_PATH);
    if (!response.ok) throw new Error('Data not found');
    
    const articles = await response.json();
    
    // Double the array to make the marquee seamless
    const displayList = articles.length > 0 ? [...articles, ...articles] : [];
    
    if (displayList.length === 0) {
      marquee.innerHTML = '<div class="news-item">GLAIDO — RUN SCRAPER TO POPULATE FEED</div>';
      return;
    }
    
    marquee.innerHTML = displayList.map(article => `
      <div class="news-item">
        <span class="news-dot">✦</span>
        <span class="news-source">${article.source}</span>
        <span class="news-title">${article.title}</span>
      </div>
    `).join('');
    
  } catch (err) {
    console.error('Marquee load failed:', err);
    marquee.innerHTML = '<div class="news-item">GLAIDO — THE AI INTELLIGENCE FEED. RUN SCRAPER TO POPULATE.</div>';
  }
}

// Initialise
document.addEventListener('DOMContentLoaded', () => {
  createStars();
  initMarquee();
});
