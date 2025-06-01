import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Check consistency across all JSON files and identify redundant files
 */

async function checkFileConsistency() {
  console.log("🔍 Checking file consistency across all JSON files...");
  
  const files = {
    // Main structured data
    structured: 'data/wpfl_extracted/wpfl_structured_data.json',
    validated: 'data/wpfl_properly_extracted/wpfl_validated_data.json',
    dynamic: 'data/wpfl_properly_extracted/dynamic_analysis.json',
    
    // Performance files
    ownerPerf1: 'data/wpfl_extracted/ownerPerformance.json',
    ownerPerf2: 'data/wpfl_properly_extracted/owner_performance_validated.json',
    
    // Head-to-head files
    h2h1: 'data/wpfl_extracted/headToHeadMatrix.json',
    h2h2: 'data/wpfl_properly_extracted/head_to_head_validated.json',
    
    // Trade files
    trade: 'data/wpfl_extracted/tradeAnalysis.json',
    
    // Trends files
    trends: 'data/wpfl_extracted/historicalTrends.json',
    
    // Other files
    confirmed: 'data/wpfl_properly_extracted/wpfl_confirmed_data_only.json',
    limited: 'data/wpfl_properly_extracted/limited_analysis.json'
  };
  
  const loadedFiles = {};
  const issues = [];
  
  // Load all files
  for (const [key, filePath] of Object.entries(files)) {
    try {
      const fullPath = path.join(__dirname, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      loadedFiles[key] = JSON.parse(content);
      console.log(`✅ Loaded ${key}: ${filePath}`);
    } catch (error) {
      console.log(`❌ Failed to load ${key}: ${error.message}`);
      issues.push(`Failed to load ${key}: ${error.message}`);
    }
  }
  
  console.log(`\n📊 Loaded ${Object.keys(loadedFiles).length} files`);
  
  // Check data consistency
  console.log("\n🔍 Checking data consistency...");
  
  // 1. Owner win totals across files
  const ownerWinComparison = {};
  
  if (loadedFiles.structured) {
    Object.entries(loadedFiles.structured.owners.actualWins2015to2024).forEach(([owner, wins]) => {
      ownerWinComparison[owner] = { structured: wins };
    });
  }
  
  if (loadedFiles.validated) {
    Object.entries(loadedFiles.validated.expectedWins).forEach(([owner, data]) => {
      if (!ownerWinComparison[owner]) ownerWinComparison[owner] = {};
      ownerWinComparison[owner].validated = data.actualWins;
    });
  }
  
  if (loadedFiles.dynamic) {
    loadedFiles.dynamic.ownerPerformance.allTimeRankings.forEach(ranking => {
      if (!ownerWinComparison[ranking.owner]) ownerWinComparison[ranking.owner] = {};
      ownerWinComparison[ranking.owner].dynamic = ranking.actualWins;
    });
  }
  
  // Check for inconsistencies
  for (const [owner, sources] of Object.entries(ownerWinComparison)) {
    const values = Object.values(sources);
    const unique = [...new Set(values)];
    
    if (unique.length > 1) {
      issues.push(`${owner} has inconsistent win totals: ${JSON.stringify(sources)}`);
    }
  }
  
  // 2. Check for redundant files
  console.log("\n🔄 Identifying redundant files...");
  
  const redundancyCheck = {
    ownerPerformance: ['ownerPerf1', 'ownerPerf2'],
    headToHead: ['h2h1', 'h2h2']
  };
  
  for (const [category, fileKeys] of Object.entries(redundancyCheck)) {
    const availableFiles = fileKeys.filter(key => loadedFiles[key]);
    
    if (availableFiles.length > 1) {
      console.log(`⚠️ Multiple ${category} files found:`);
      availableFiles.forEach(key => {
        const fileData = loadedFiles[key];
        const metadata = fileData.metadata || fileData.source || 'No metadata';
        console.log(`   - ${files[key]}: ${metadata}`);
      });
      
      // Compare content to see if truly redundant
      if (availableFiles.length === 2) {
        const [file1, file2] = availableFiles;
        const data1 = loadedFiles[file1];
        const data2 = loadedFiles[file2];
        
        // Quick size comparison
        const size1 = JSON.stringify(data1).length;
        const size2 = JSON.stringify(data2).length;
        const sizeRatio = Math.min(size1, size2) / Math.max(size1, size2);
        
        if (sizeRatio > 0.8) {
          console.log(`     💡 Files are similar in size (${size1} vs ${size2}) - likely redundant`);
        } else {
          console.log(`     📊 Files differ significantly (${size1} vs ${size2}) - may serve different purposes`);
        }
      }
    }
  }
  
  // 3. Check file purposes and recommendations
  console.log("\n📋 File Purpose Analysis:");
  
  const filePurposes = {
    structured: "Main structured data - PRIMARY",
    validated: "Cross-validated data with API - VALIDATION",
    dynamic: "Dynamic analysis with insights - ANALYSIS",
    ownerPerf1: "Owner performance from structured data",
    ownerPerf2: "Owner performance from validated data",
    h2h1: "Head-to-head matrix from structured data", 
    h2h2: "Head-to-head validated from API",
    trade: "Trade analysis from Excel",
    trends: "Historical trends analysis",
    confirmed: "Confirmed data only (limited)",
    limited: "Limited analysis (subset)"
  };
  
  for (const [key, purpose] of Object.entries(filePurposes)) {
    if (loadedFiles[key]) {
      const size = JSON.stringify(loadedFiles[key]).length;
      console.log(`✅ ${files[key]}: ${purpose} (${size} chars)`);
    }
  }
  
  // 4. Generate recommendations
  console.log("\n💡 RECOMMENDATIONS:");
  
  const recommendations = [];
  
  // Check for truly redundant files
  if (loadedFiles.ownerPerf1 && loadedFiles.ownerPerf2) {
    recommendations.push("Consider consolidating owner performance files - use owner_performance_validated.json as primary");
  }
  
  if (loadedFiles.h2h1 && loadedFiles.h2h2) {
    recommendations.push("Consider consolidating head-to-head files - use head_to_head_validated.json as primary");
  }
  
  if (loadedFiles.confirmed && loadedFiles.limited) {
    recommendations.push("Files 'confirmed' and 'limited' may be obsolete if 'validated' contains complete data");
  }
  
  // Check for missing key data
  if (!loadedFiles.structured) {
    recommendations.push("❌ CRITICAL: Main structured data file is missing");
  }
  
  if (!loadedFiles.validated) {
    recommendations.push("❌ CRITICAL: Validated data file is missing");
  }
  
  if (!loadedFiles.dynamic) {
    recommendations.push("⚠️ Dynamic analysis file is missing - regenerate for latest insights");
  }
  
  if (recommendations.length === 0) {
    console.log("✅ No major issues found - file structure looks good");
  } else {
    recommendations.forEach(rec => console.log(`- ${rec}`));
  }
  
  // 5. Summary
  console.log("\n📊 SUMMARY:");
  console.log(`Files loaded: ${Object.keys(loadedFiles).length}/${Object.keys(files).length}`);
  console.log(`Issues found: ${issues.length}`);
  console.log(`Recommendations: ${recommendations.length}`);
  
  if (issues.length > 0) {
    console.log("\n❌ ISSUES:");
    issues.forEach(issue => console.log(`- ${issue}`));
  } else {
    console.log("\n✅ DATA CONSISTENCY: All checks passed");
  }
  
  return {
    filesLoaded: Object.keys(loadedFiles).length,
    totalFiles: Object.keys(files).length,
    issues,
    recommendations,
    consistent: issues.length === 0
  };
}

// Run consistency check
checkFileConsistency().catch(console.error);