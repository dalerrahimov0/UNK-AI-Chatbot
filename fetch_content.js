const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');

async function processUrl(url) {
  try {
    console.log(`Fetching content from: ${url}`);
    const response = await fetch(url);
    const html = await response.text();
    
    // Parse HTML using JSDOM
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Extract main content
    // Note: This selector may need to be adjusted based on the actual website structure
    const mainContent = document.querySelector('#unkWrapper');
    
    // Convert to markdown-like format
    let markdownContent = '';
    
    // Add the URL as a reference
    markdownContent += `# Content from ${url}\n\n`;
    
    // Extract headings and paragraphs
    const headings = mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(heading => {
      const level = parseInt(heading.tagName.substring(1));
      const prefix = '#'.repeat(level + 1); // Add one to account for the title we added
      markdownContent += `${prefix} ${heading.textContent.trim()}\n\n`;
    });
    
    const paragraphs = mainContent.querySelectorAll('p');
    paragraphs.forEach(p => {
      markdownContent += `${p.textContent.trim()}\n\n`;
    });
    
    // Extract lists
    const lists = mainContent.querySelectorAll('ul, ol');
    lists.forEach(list => {
      const items = list.querySelectorAll('li');
      items.forEach(item => {
        markdownContent += `- ${item.textContent.trim()}\n`;
      });
      markdownContent += '\n';
    });
    
    // Create docs directory if it doesn't exist
    const docsDir = path.join(__dirname, 'docs');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir);
    }
    
    // Generate filename from URL
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/\./g, '_');
    const pathname = urlObj.pathname.replace(/[\/\.]/g, '_');
    const filename = `${hostname}${pathname}.md`;
    
    // Write to file
    const filePath = path.join(docsDir, filename);
    fs.writeFileSync(filePath, markdownContent);
    console.log(`Content saved to ${filePath}`);
    
    return filename;
  } catch (error) {
    console.error(`Error processing ${url}:`, error);
    return null;
  }
}

async function fetchContentAndSaveToMarkdown(urls) {
  // If a single URL is provided as a string, convert to array
  if (typeof urls === 'string') {
    urls = [urls];
  }
  
  if (!Array.isArray(urls)) {
    console.error('URLs must be provided as an array or a single string URL');
    return;
  }
  
  console.log(`Processing ${urls.length} URLs...`);
  
  const results = [];
  
  // Process URLs in parallel
  const promises = urls.map(url => processUrl(url));
  const fileNames = await Promise.all(promises);
  
  fileNames.forEach((fileName, index) => {
    if (fileName) {
      results.push({
        url: urls[index],
        fileName,
        success: true
      });
    } else {
      results.push({
        url: urls[index],
        success: false
      });
    }
  });
  
  console.log('Completed processing all URLs:');
  console.table(results);
  
  return results;
}

// Example usage:
// For a single URL
// fetchContentAndSaveToMarkdown('https://www.unk.edu/offices/police/parking_services.php');

// For multiple URLs
// fetchContentAndSaveToMarkdown([
//   'https://www.unk.edu/offices/police/parking_services.php',
//   'https://www.unk.edu/academics/index.php'
// ]);

// If called directly (not imported)
if (require.main === module) {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.log('Please provide at least one URL as a command line argument');
    console.log('Example: node fetch_content.js https://example.com https://another-example.com');
  } else {
    fetchContentAndSaveToMarkdown(urls);
  }
}

module.exports = { fetchContentAndSaveToMarkdown };
