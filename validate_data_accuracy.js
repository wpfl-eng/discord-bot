import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Validate all JSON files against fresh API data
 */

async function validateDataAccuracy() {
  console.log("🔍 Validating JSON files against API data...");
  
  const validationResults = {
    expectedWins: { accurate: true, discrepancies: [] },
    headToHead: { accurate: true, discrepancies: [] },
    fileConsistency: { accurate: true, discrepancies: [] }
  };
  
  try {
    // Fetch fresh API data
    console.log("📡 Fetching fresh API data...");
    
    const expectedWinsResponse = await fetch('https://wpflapi.azurewebsites.net/api/expectedwins?seasonMax=2024&seasonMin=2015&includePlayoffs=false');
    const apiExpectedWins = await expectedWinsResponse.json();
    
    const matchupResponse = await fetch('https://wpflapi.azurewebsites.net/api/fantasyMatchupWinners?seasonMax=2024&seasonMin=2020&weekMax=17&weekMin=1');
    const apiMatchups = await matchupResponse.json();
    
    console.log(`✅ Fetched ${apiExpectedWins.length} expected wins records`);
    console.log(`✅ Fetched ${apiMatchups.length} matchup records`);
    
    // Load our JSON files for comparison
    const structuredDataPath = path.join(__dirname, 'data', 'wpfl_extracted', 'wpfl_structured_data.json');
    const structuredData = JSON.parse(await fs.readFile(structuredDataPath, 'utf-8'));
    
    const validatedDataPath = path.join(__dirname, 'data', 'wpfl_properly_extracted', 'wpfl_validated_data.json');
    const validatedData = JSON.parse(await fs.readFile(validatedDataPath, 'utf-8'));
    
    const dynamicAnalysisPath = path.join(__dirname, 'data', 'wpfl_properly_extracted', 'dynamic_analysis.json');
    const dynamicAnalysis = JSON.parse(await fs.readFile(dynamicAnalysisPath, 'utf-8'));
    
    // 1. Validate Expected Wins Data
    console.log("\n🎯 Validating Expected Wins Data...");
    
    // Filter API data to only include WPFL owners (exclude temporary/inactive ones)
    const wpflOwners = structuredData.owners.list;
    const apiWPFLData = apiExpectedWins.filter(owner => wpflOwners.includes(owner.owner));
    
    console.log(`📊 Comparing ${wpflOwners.length} WPFL owners`);
    
    for (const owner of wpflOwners) {
      const apiOwner = apiWPFLData.find(a => a.owner === owner);
      const structuredOwner = {
        actualWins: structuredData.owners.actualWins2015to2024[owner],
        expectedWins: structuredData.owners.expectedWins2015to2024[owner]
      };
      
      if (!apiOwner) {
        validationResults.expectedWins.discrepancies.push({
          owner,
          issue: "Missing from API data",
          expected: structuredOwner,
          actual: null
        });
        validationResults.expectedWins.accurate = false;
        continue;
      }
      
      // Check for discrepancies
      if (apiOwner.actualWins !== structuredOwner.actualWins) {
        validationResults.expectedWins.discrepancies.push({
          owner,
          field: "actualWins",
          expected: structuredOwner.actualWins,
          actual: apiOwner.actualWins,
          difference: apiOwner.actualWins - structuredOwner.actualWins
        });
        validationResults.expectedWins.accurate = false;
      }
      
      if (Math.abs(apiOwner.expectedWins - structuredOwner.expectedWins) > 0.01) {
        validationResults.expectedWins.discrepancies.push({
          owner,
          field: "expectedWins",
          expected: structuredOwner.expectedWins,
          actual: apiOwner.expectedWins,
          difference: (apiOwner.expectedWins - structuredOwner.expectedWins).toFixed(2)
        });
        validationResults.expectedWins.accurate = false;
      }
    }
    
    // 2. Validate Head-to-Head Data (sample check)
    console.log("\n⚔️ Validating Head-to-Head Data...");
    
    // Count matchups by owner from API
    const h2hCounts = {};
    apiMatchups.forEach(game => {
      const teamA = game.teamA;
      const teamB = game.teamB;
      
      if (!h2hCounts[teamA]) h2hCounts[teamA] = {};
      if (!h2hCounts[teamB]) h2hCounts[teamB] = {};
      
      if (!h2hCounts[teamA][teamB]) h2hCounts[teamA][teamB] = { wins: 0, losses: 0 };
      if (!h2hCounts[teamB][teamA]) h2hCounts[teamB][teamA] = { wins: 0, losses: 0 };
      
      if (game.teamAPoints > game.teamBPoints) {
        h2hCounts[teamA][teamB].wins++;
        h2hCounts[teamB][teamA].losses++;
      } else {
        h2hCounts[teamB][teamA].wins++;
        h2hCounts[teamA][teamB].losses++;
      }
    });
    
    // Sample validation of dominant pairs from dynamic analysis
    const dominantPairs = dynamicAnalysis.dominancePatterns.dominantPairs.slice(0, 5); // Check first 5
    
    for (const pair of dominantPairs) {
      const apiRecord = h2hCounts[pair.dominator]?.[pair.victim];
      if (apiRecord) {
        const expectedWins = parseInt(pair.record.split('-')[0]);
        const expectedLosses = parseInt(pair.record.split('-')[1]);
        
        if (apiRecord.wins !== expectedWins || apiRecord.losses !== expectedLosses) {
          validationResults.headToHead.discrepancies.push({
            matchup: `${pair.dominator} vs ${pair.victim}`,
            expected: pair.record,
            actual: `${apiRecord.wins}-${apiRecord.losses}`,
            issue: "Record mismatch"
          });
          validationResults.headToHead.accurate = false;
        }
      }
    }
    
    // 3. Check File Consistency
    console.log("\n🔗 Checking File Consistency...");
    
    // Compare structured data with validated data
    for (const owner of wpflOwners) {
      const structuredWins = structuredData.owners.actualWins2015to2024[owner];
      const validatedWins = validatedData.expectedWins[owner]?.actualWins;
      const dynamicWins = dynamicAnalysis.ownerPerformance.allTimeRankings.find(o => o.owner === owner)?.actualWins;
      
      if (structuredWins !== validatedWins || structuredWins !== dynamicWins) {
        validationResults.fileConsistency.discrepancies.push({
          owner,
          structured: structuredWins,
          validated: validatedWins,
          dynamic: dynamicWins,
          issue: "Inconsistent actual wins across files"
        });
        validationResults.fileConsistency.accurate = false;
      }
    }
    
    // Print Results
    console.log("\n📋 VALIDATION RESULTS");
    console.log("=" .repeat(50));
    
    console.log(`\n🎯 Expected Wins: ${validationResults.expectedWins.accurate ? '✅ ACCURATE' : '❌ ISSUES FOUND'}`);
    if (validationResults.expectedWins.discrepancies.length > 0) {
      console.log(`   Issues: ${validationResults.expectedWins.discrepancies.length}`);
      validationResults.expectedWins.discrepancies.forEach(d => {
        console.log(`   - ${d.owner}: ${d.field} expected ${d.expected}, got ${d.actual} (diff: ${d.difference})`);
      });
    }
    
    console.log(`\n⚔️ Head-to-Head: ${validationResults.headToHead.accurate ? '✅ ACCURATE' : '❌ ISSUES FOUND'}`);
    if (validationResults.headToHead.discrepancies.length > 0) {
      console.log(`   Issues: ${validationResults.headToHead.discrepancies.length}`);
      validationResults.headToHead.discrepancies.forEach(d => {
        console.log(`   - ${d.matchup}: expected ${d.expected}, got ${d.actual}`);
      });
    }
    
    console.log(`\n🔗 File Consistency: ${validationResults.fileConsistency.accurate ? '✅ ACCURATE' : '❌ ISSUES FOUND'}`);
    if (validationResults.fileConsistency.discrepancies.length > 0) {
      console.log(`   Issues: ${validationResults.fileConsistency.discrepancies.length}`);
      validationResults.fileConsistency.discrepancies.forEach(d => {
        console.log(`   - ${d.owner}: structured=${d.structured}, validated=${d.validated}, dynamic=${d.dynamic}`);
      });
    }
    
    // Overall Summary
    const allAccurate = validationResults.expectedWins.accurate && 
                       validationResults.headToHead.accurate && 
                       validationResults.fileConsistency.accurate;
    
    console.log(`\n🏆 OVERALL STATUS: ${allAccurate ? '✅ ALL DATA VALIDATED' : '⚠️ ISSUES REQUIRE ATTENTION'}`);
    
    // Save validation report
    const reportPath = path.join(__dirname, 'data_validation_report.json');
    await fs.writeFile(reportPath, JSON.stringify(validationResults, null, 2));
    console.log(`\n📄 Detailed validation report saved: ${reportPath}`);
    
    return validationResults;
    
  } catch (error) {
    console.error("❌ Validation failed:", error);
    return { error: error.message };
  }
}

// Run validation
validateDataAccuracy().catch(console.error);