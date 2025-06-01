# Discord Bot Command Proposals - Ranked Edition

## Ranking Criteria:
- **🔥 WOW Factor** (1-10): How mind-blowing and impressive
- **😎 Cool Factor** (1-10): How much league members will love it  
- **✅ Validity** (1-10): How useful/accurate with available data
- **⚡ Effort** (1-10): How easy to implement (10 = easiest)
- **Overall Score**: Weighted average (WOW×3 + Cool×3 + Valid×2 + Effort×2)/10

---

## 🏆 TOP TIER (Score 8.0+)

### 1. `/prophecy` - AI-Powered Draft Predictions
**Score: 9.2** | WOW: 10 | Cool: 10 | Valid: 8 | Effort: 8
```
Based on 14 years of draft data, predicts:
- "90% chance you draft a Bengals player by round 4"
- "You'll spend $73 on a RB who disappoints you"
- "Your round 8 sleeper will outscore your round 2 pick"
```
**Implementation**: Use existing draft trends data + GPT for creative predictions

### 2. `/draftdna` - Visual Draft Personality Profile  
**Score: 8.8** | WOW: 10 | Cool: 9 | Valid: 9 | Effort: 7
```
Creates a "DNA strand" visualization showing:
- Risk tolerance (conservative ← → aggressive)
- Team loyalty (mercenary ← → superfan)
- Position philosophy (RB-heavy ← → Zero-RB)
- Value hunting (reaches ← → bargain hunter)
```
**Implementation**: Already built! Just needs visualization

### 3. `/cursed` - Statistical Nightmares Personalized
**Score: 8.6** | WOW: 9 | Cool: 10 | Valid: 8 | Effort: 8

**Command Usage**: `/cursed user:Nixon Ball seasonmin:2018 seasonmax:2024`

**Dynamic Response Example**:
```
🔮 THE CURSE OF NIXON BALL (2018-2024)

😱 HEARTBREAK STATISTICS:
• Lost 8 games by <5 points (most in league)
• 2-11 record in games decided by <3 points
• Worst bad beat: Lost by 0.4 after opponent's DEF scored 23 (Week 14, 2021)

⚡ WHEN IT RAINS, IT POURS:
• Faced highest Points Against in 2019, 2021, 2023
• 14 weeks where 3+ starters scored <5 points
• Record when projected to win by 20+: 3-4 (worst in league)

🎯 SPECIFIC CURSES:
• The "Monday Night Massacre": 0-7 when opponent has MNF player left
• The "Kicker Curse": 0-9 when opponent's K scores 15+
• The "Backup QB Special": Lost 5 games to opponents starting backup QBs
• The "Week 13 Wormhole": 1-6 all-time in Week 13

💔 SOUL-CRUSHING PATTERNS:
• 6 times eliminated from playoffs in final week
• Average margin in playoff losses: 3.2 points
• Most bench points in losses: 187.3 (would've won by 40)

🔥 THE ULTIMATE CURSE:
"Nixon's Law": The more you need the win, the weirder the loss
- Win % in must-win games: 28.6%
- Win % in meaningless games: 71.4%
```

**Different User Example** - `/cursed user:AJ Boorde seasonmin:2020 seasonmax:2024`:
```
🔮 THE CURSE OF AJ BOORDE (2020-2024)

😱 HEARTBREAK STATISTICS:
• 5-1 record in games decided by <3 points (luckiest in league)
• Only 2 losses by <5 points in 5 years
• Worst bad beat: Lost championship by 1.8 after stat correction (2022)

⚡ THE CHAMPION'S CURSE:
• Won regular season 3x, only 1 championship
• Playoff record after bye: 2-3 (worst among bye recipients)
• Average playoff loss margin: 22.4 points (get blown out)

🎯 SPECIFIC CURSES:
• The "Trap Game Special": 3-7 vs teams under .400
• The "Division Curse": 12-18 vs division rivals
• The "Prime Time Choke": 2-6 when all eyes watching (MNF/SNF heavy)
• The "Week 1 Hangover": 1-4 in season openers

💔 PATTERNS OF PAIN:
• Led at halftime in 89% of losses (most in league)
• 4 losses when scoring 130+ points
• Record when favored by 30+: 5-2 (only losses in league)

🔥 THE ULTIMATE CURSE:
"AJ's Paradox": The better your team looks on paper, the worse the playoff exit
- Regular season win %: 68.8%
- Playoff win %: 40.0%
```

**Implementation Details**:
```javascript
// Core data queries needed:
1. fantasyMatchupWinners API - Get all games for margin analysis
2. playerscores API - For specific player performance patterns
3. Custom calculations:
   - Games by margin buckets (<3, <5, <10)
   - Opponent position scoring patterns
   - Week-specific performance
   - Situational records (must-win, playoffs, etc.)
   - Bench points in losses
   
// Key features:
- Fully dynamic based on user selection
- Different curse categories per user
- Season range flexibility
- Mix of heartbreak stats + funny patterns
- Memorable "Ultimate Curse" summary
```

**Why This Works**:
- Uses real data but presents it in entertaining way
- Each user gets completely different curses based on their history
- Highlights genuinely surprising/painful patterns
- Mix of legitimate analysis and superstitious fun
- Season range option lets users explore different eras

### 4. `/rivalry` - Head-to-Head Deep Dive
**Score: 8.4** | WOW: 8 | Cool: 9 | Valid: 10 | Effort: 7
```
"THE ETERNAL STRUGGLE: Nixon vs AJ
Overall: Nixon leads 15-12
Biggest blowout: AJ by 67.3 (Week 8, 2018)
Current streak: Nixon (3 games)
Trash talk fuel: Nixon is 1-4 in playoffs vs AJ"
```
**Implementation**: Query fantasyMatchupWinners API with aggregation

### 5. `/miracle` - Greatest Comebacks & Collapses
**Score: 8.2** | WOW: 9 | Cool: 9 | Valid: 8 | Effort: 7
```
"🎭 MONDAY NIGHT MIRACLES:
- Biggest comeback: Down 45 pts with 1 player left (won by 2)
- Worst collapse: Up 40 with opponent's DEF left (lost by 1)  
- Most improbable win: 12% chance according to projections"
```
**Implementation**: Calculate win probability based on scores + remaining players

---

## 🥈 HIGH TIER (Score 7.0-7.9)

### 6. `/nemesis` - Your Personal Kryptonite
**Score: 7.8** | WOW: 8 | Cool: 9 | Valid: 9 | Effort: 6
```
"😱 YOUR WORST NIGHTMARES:
1. Mike Simpson (2-11 all-time) - He owns you
2. Plays on Todd's schedule (3-9) - Can't solve him
3. Week 13 (2-8) - Your bermuda triangle"
```

### 7. `/clutch` - Pressure Performance Rating
**Score: 7.6** | WOW: 8 | Cool: 8 | Valid: 8 | Effort: 7
```
"CLUTCH RATING: 87/100 🎯
- Playoff record: 8-3 (72.7%)
- Win % in must-win games: 83.3%
- Average score under pressure: +8.3 pts"
```

### 8. `/coachingfail` - Lineup Disaster Tracker
**Score: 7.4** | WOW: 7 | Cool: 8 | Valid: 9 | Effort: 7
```
"🤦 WORST COACHING DECISIONS:
Week 8, 2023: Left 43 pts on bench (lost by 2)
- Benched: Justin Jefferson (38.5)
- Started: Injured player (0.0)"
```

### 9. `/powerrankings` - Algorithm-Based Rankings
**Score: 7.2** | WOW: 7 | Cool: 8 | Valid: 8 | Effort: 7
```
"📊 TRUE POWER RANKINGS (Week 10):
1. AJ Boorde (Score: 92.3) ⬆️
   - Record: 7-3 | Point Diff: +127 | SOS: .543
2. Nixon Ball (Score: 88.7) ⬇️"
```

### 10. `/trash` - Auto-Generated Trash Talk
**Score: 7.0** | WOW: 8 | Cool: 9 | Valid: 6 | Effort: 6
```
"🗑️ TRASH TALK AMMO vs Nixon:
- He's 0-4 when you score 100+
- His 'stud' WR averages 8.2 pts vs you
- Last time he beat you, Bitcoin was $500"
```

---

## 🥉 MID TIER (Score 6.0-6.9)

### 11. `/sleeper` - Late Round Hall of Fame
**Score: 6.8** | WOW: 6 | Cool: 7 | Valid: 9 | Effort: 7

### 12. `/schedule` - Strength of Schedule Analysis  
**Score: 6.6** | WOW: 6 | Cool: 6 | Valid: 10 | Effort: 7

### 13. `/benchwarmer` - Best Bench Performances
**Score: 6.4** | WOW: 6 | Cool: 7 | Valid: 8 | Effort: 7

### 14. `/consistency` - Scoring Variance Analysis
**Score: 6.2** | WOW: 5 | Cool: 6 | Valid: 9 | Effort: 8

### 15. `/trajectory` - Performance Trends
**Score: 6.0** | WOW: 6 | Cool: 6 | Valid: 8 | Effort: 6

---

## 🔧 EASY WINS (High Impact, Low Effort)

### 16. `/luckiest` - Expected vs Actual Wins
**Score: 7.0** | WOW: 7 | Cool: 8 | Valid: 10 | Effort: 9
```
"🍀 LUCK RATING: +3.7 wins above expected
You should be 6-7 but you're 10-3!"
```
**Implementation**: Direct API call to expectedwins endpoint

### 17. `/records` - League Record Book
**Score: 6.8** | WOW: 6 | Cool: 7 | Valid: 10 | Effort: 8
```
"📚 LEAGUE RECORDS:
Highest Score: 187.3 (AJ, Week 13 2019)
Biggest Blowout: 94.2 points
Longest Win Streak: 11 games"
```

### 18. `/stats` - Quick Personal Stats
**Score: 6.5** | WOW: 5 | Cool: 7 | Valid: 10 | Effort: 9
```
All-time record, average score, championships, etc.
```

---

## 💡 NEW IDEAS (Not in Original)

### 19. `/vibes` - Momentum Tracker
**Score: 8.0** | WOW: 8 | Cool: 9 | Valid: 7 | Effort: 7
```
"📈 VIBE CHECK: You're HOT 🔥
- Current streak: W3
- Last 5 scoring trend: ⬆️⬆️➡️⬆️⬆️
- Confidence level: BIG DAWG MODE"
```

### 20. `/beef` - Historical Feuds & Drama
**Score: 7.5** | WOW: 8 | Cool: 10 | Valid: 5 | Effort: 6
```
"🥩 LEAGUE BEEF HISTORY:
- The Great Veto of 2019
- Nixon's Controversial Championship*
- The AJ-Mike Trade War of 2021"
```

### 21. `/guarantee` - Bold Weekly Predictions
**Score: 7.8** | WOW: 9 | Cool: 9 | Valid: 5 | Effort: 7
```
"🎯 WEEK 10 GUARANTEES:
- Nixon scores <80 (hasn't happened in 47 weeks)
- AJ's RB1 outscores his QB1 (73% historical rate)
- Someone wins by exactly 0.1 points"
```

### 22. `/zodiac` - Fantasy Football Horoscope
**Score: 7.2** | WOW: 8 | Cool: 9 | Valid: 3 | Effort: 8
```
"♈ FANTASY HOROSCOPE:
Mercury in retrograde means bench your Dolphins
Your lucky round: 7
Avoid: Players named Josh"
```

---

## 🚀 IMPLEMENTATION PRIORITY

### Phase 1 (This Week) - Highest Impact + Easiest
1. `/luckiest` & `/unluckiest` - Direct API calls
2. `/records` - Simple aggregation
3. `/rivalry` - Uses existing matchup data

### Phase 2 (Next Sprint) - The Wow Factor
4. `/prophecy` - Integrate with GPT
5. `/cursed` & `/miracle` - Pattern matching
6. `/nemesis` - H2H analysis

### Phase 3 (Future) - The Complex Ones
7. `/powerrankings` - Need algorithm design
8. `/vibes` - Momentum calculations
9. `/trash` - AI integration

## NOTES:
- All scores consider we have ESPN data (2010-2024) and performance data (2015-2024)
- Commands using existing APIs score higher on effort
- "Wow factor" heavily weights uniqueness and entertainment value
- Some low-validity ideas (like `/zodiac`) score well on fun factor alone