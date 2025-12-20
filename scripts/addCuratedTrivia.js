/**
 * Add manually curated NFL trivia questions
 * Run after generateNflTrivia.js to merge curated questions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Manually curated questions - verified data
const CURATED_QUESTIONS = [
  // Super Bowl Winners (2010-2024 seasons)
  {
    id: 'nfl_sb_xlv',
    question: 'Which team won Super Bowl XLV after the 2010 season?',
    answer: 'Green Bay Packers',
    acceptable_answers: ['Green Bay Packers', 'Packers', 'Green Bay', 'GB'],
    point_value: 1,
    metadata: { year: 2010, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_xlvi',
    question: 'Which team won Super Bowl XLVI after the 2011 season?',
    answer: 'New York Giants',
    acceptable_answers: ['New York Giants', 'Giants', 'NY Giants', 'NYG'],
    point_value: 1,
    metadata: { year: 2011, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_xlvii',
    question: 'Which team won Super Bowl XLVII after the 2012 season?',
    answer: 'Baltimore Ravens',
    acceptable_answers: ['Baltimore Ravens', 'Ravens', 'Baltimore', 'BAL'],
    point_value: 1,
    metadata: { year: 2012, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_xlviii',
    question: 'Which team won Super Bowl XLVIII after the 2013 season?',
    answer: 'Seattle Seahawks',
    acceptable_answers: ['Seattle Seahawks', 'Seahawks', 'Seattle', 'SEA'],
    point_value: 1,
    metadata: { year: 2013, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_xlix',
    question: 'Which team won Super Bowl XLIX after the 2014 season?',
    answer: 'New England Patriots',
    acceptable_answers: ['New England Patriots', 'Patriots', 'New England', 'NE', 'Pats'],
    point_value: 1,
    metadata: { year: 2014, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_50',
    question: 'Which team won Super Bowl 50 after the 2015 season?',
    answer: 'Denver Broncos',
    acceptable_answers: ['Denver Broncos', 'Broncos', 'Denver', 'DEN'],
    point_value: 1,
    metadata: { year: 2015, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_li',
    question: 'Which team won Super Bowl LI after the 2016 season?',
    answer: 'New England Patriots',
    acceptable_answers: ['New England Patriots', 'Patriots', 'New England', 'NE', 'Pats'],
    point_value: 1,
    metadata: { year: 2016, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_lii',
    question: 'Which team won Super Bowl LII after the 2017 season?',
    answer: 'Philadelphia Eagles',
    acceptable_answers: ['Philadelphia Eagles', 'Eagles', 'Philadelphia', 'Philly', 'PHI'],
    point_value: 1,
    metadata: { year: 2017, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_liii',
    question: 'Which team won Super Bowl LIII after the 2018 season?',
    answer: 'New England Patriots',
    acceptable_answers: ['New England Patriots', 'Patriots', 'New England', 'NE', 'Pats'],
    point_value: 1,
    metadata: { year: 2018, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_liv',
    question: 'Which team won Super Bowl LIV after the 2019 season?',
    answer: 'Kansas City Chiefs',
    acceptable_answers: ['Kansas City Chiefs', 'Chiefs', 'Kansas City', 'KC'],
    point_value: 1,
    metadata: { year: 2019, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_lv',
    question: 'Which team won Super Bowl LV after the 2020 season?',
    answer: 'Tampa Bay Buccaneers',
    acceptable_answers: ['Tampa Bay Buccaneers', 'Buccaneers', 'Tampa Bay', 'Bucs', 'TB'],
    point_value: 1,
    metadata: { year: 2020, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_lvi',
    question: 'Which team won Super Bowl LVI after the 2021 season?',
    answer: 'Los Angeles Rams',
    acceptable_answers: ['Los Angeles Rams', 'Rams', 'LA Rams', 'LAR'],
    point_value: 1,
    metadata: { year: 2021, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_lvii',
    question: 'Which team won Super Bowl LVII after the 2022 season?',
    answer: 'Kansas City Chiefs',
    acceptable_answers: ['Kansas City Chiefs', 'Chiefs', 'Kansas City', 'KC'],
    point_value: 1,
    metadata: { year: 2022, category: 'super_bowl' },
  },
  {
    id: 'nfl_sb_lviii',
    question: 'Which team won Super Bowl LVIII after the 2023 season?',
    answer: 'Kansas City Chiefs',
    acceptable_answers: ['Kansas City Chiefs', 'Chiefs', 'Kansas City', 'KC'],
    point_value: 1,
    metadata: { year: 2023, category: 'super_bowl' },
  },

  // Super Bowl MVPs
  {
    id: 'nfl_sbmvp_xlv',
    question: 'Who was the Super Bowl XLV MVP?',
    answer: 'Aaron Rodgers',
    acceptable_answers: ['Aaron Rodgers', 'Rodgers', 'A-Rod'],
    point_value: 2,
    metadata: { year: 2010, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_xlvi',
    question: 'Who was the Super Bowl XLVI MVP?',
    answer: 'Eli Manning',
    acceptable_answers: ['Eli Manning', 'Manning', 'Eli'],
    point_value: 2,
    metadata: { year: 2011, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_xlvii',
    question: 'Who was the Super Bowl XLVII MVP?',
    answer: 'Joe Flacco',
    acceptable_answers: ['Joe Flacco', 'Flacco'],
    point_value: 2,
    metadata: { year: 2012, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_xlviii',
    question: 'Who was the Super Bowl XLVIII MVP?',
    answer: 'Malcolm Smith',
    acceptable_answers: ['Malcolm Smith', 'Smith'],
    point_value: 3,
    metadata: { year: 2013, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_xlix',
    question: 'Who was the Super Bowl XLIX MVP?',
    answer: 'Tom Brady',
    acceptable_answers: ['Tom Brady', 'Brady'],
    point_value: 2,
    metadata: { year: 2014, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_50',
    question: 'Who was the Super Bowl 50 MVP?',
    answer: 'Von Miller',
    acceptable_answers: ['Von Miller', 'Miller'],
    point_value: 2,
    metadata: { year: 2015, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_li',
    question: 'Who was the Super Bowl LI MVP?',
    answer: 'Tom Brady',
    acceptable_answers: ['Tom Brady', 'Brady'],
    point_value: 2,
    metadata: { year: 2016, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_lii',
    question: 'Who was the Super Bowl LII MVP?',
    answer: 'Nick Foles',
    acceptable_answers: ['Nick Foles', 'Foles'],
    point_value: 2,
    metadata: { year: 2017, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_liii',
    question: 'Who was the Super Bowl LIII MVP?',
    answer: 'Julian Edelman',
    acceptable_answers: ['Julian Edelman', 'Edelman'],
    point_value: 2,
    metadata: { year: 2018, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_liv',
    question: 'Who was the Super Bowl LIV MVP?',
    answer: 'Patrick Mahomes',
    acceptable_answers: ['Patrick Mahomes', 'Mahomes'],
    point_value: 2,
    metadata: { year: 2019, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_lv',
    question: 'Who was the Super Bowl LV MVP?',
    answer: 'Tom Brady',
    acceptable_answers: ['Tom Brady', 'Brady'],
    point_value: 2,
    metadata: { year: 2020, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_lvi',
    question: 'Who was the Super Bowl LVI MVP?',
    answer: 'Cooper Kupp',
    acceptable_answers: ['Cooper Kupp', 'Kupp'],
    point_value: 2,
    metadata: { year: 2021, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_lvii',
    question: 'Who was the Super Bowl LVII MVP?',
    answer: 'Patrick Mahomes',
    acceptable_answers: ['Patrick Mahomes', 'Mahomes'],
    point_value: 2,
    metadata: { year: 2022, category: 'super_bowl_mvp' },
  },
  {
    id: 'nfl_sbmvp_lviii',
    question: 'Who was the Super Bowl LVIII MVP?',
    answer: 'Patrick Mahomes',
    acceptable_answers: ['Patrick Mahomes', 'Mahomes'],
    point_value: 2,
    metadata: { year: 2023, category: 'super_bowl_mvp' },
  },

  // #1 Overall Draft Picks (2010-2024)
  {
    id: 'nfl_draft_2010',
    question: 'Who was selected #1 overall in the 2010 NFL Draft?',
    answer: 'Sam Bradford',
    acceptable_answers: ['Sam Bradford', 'Bradford'],
    point_value: 2,
    metadata: { year: 2010, category: 'draft' },
  },
  {
    id: 'nfl_draft_2011',
    question: 'Who was selected #1 overall in the 2011 NFL Draft?',
    answer: 'Cam Newton',
    acceptable_answers: ['Cam Newton', 'Newton', 'Cam'],
    point_value: 2,
    metadata: { year: 2011, category: 'draft' },
  },
  {
    id: 'nfl_draft_2012',
    question: 'Who was selected #1 overall in the 2012 NFL Draft?',
    answer: 'Andrew Luck',
    acceptable_answers: ['Andrew Luck', 'Luck'],
    point_value: 2,
    metadata: { year: 2012, category: 'draft' },
  },
  {
    id: 'nfl_draft_2013',
    question: 'Who was selected #1 overall in the 2013 NFL Draft?',
    answer: 'Eric Fisher',
    acceptable_answers: ['Eric Fisher', 'Fisher'],
    point_value: 3,
    metadata: { year: 2013, category: 'draft' },
  },
  {
    id: 'nfl_draft_2014',
    question: 'Who was selected #1 overall in the 2014 NFL Draft?',
    answer: 'Jadeveon Clowney',
    acceptable_answers: ['Jadeveon Clowney', 'Clowney'],
    point_value: 2,
    metadata: { year: 2014, category: 'draft' },
  },
  {
    id: 'nfl_draft_2015',
    question: 'Who was selected #1 overall in the 2015 NFL Draft?',
    answer: 'Jameis Winston',
    acceptable_answers: ['Jameis Winston', 'Winston', 'Jameis'],
    point_value: 2,
    metadata: { year: 2015, category: 'draft' },
  },
  {
    id: 'nfl_draft_2016',
    question: 'Who was selected #1 overall in the 2016 NFL Draft?',
    answer: 'Jared Goff',
    acceptable_answers: ['Jared Goff', 'Goff'],
    point_value: 2,
    metadata: { year: 2016, category: 'draft' },
  },
  {
    id: 'nfl_draft_2017',
    question: 'Who was selected #1 overall in the 2017 NFL Draft?',
    answer: 'Myles Garrett',
    acceptable_answers: ['Myles Garrett', 'Garrett'],
    point_value: 2,
    metadata: { year: 2017, category: 'draft' },
  },
  {
    id: 'nfl_draft_2018',
    question: 'Who was selected #1 overall in the 2018 NFL Draft?',
    answer: 'Baker Mayfield',
    acceptable_answers: ['Baker Mayfield', 'Mayfield', 'Baker'],
    point_value: 2,
    metadata: { year: 2018, category: 'draft' },
  },
  {
    id: 'nfl_draft_2019',
    question: 'Who was selected #1 overall in the 2019 NFL Draft?',
    answer: 'Kyler Murray',
    acceptable_answers: ['Kyler Murray', 'Murray', 'Kyler'],
    point_value: 2,
    metadata: { year: 2019, category: 'draft' },
  },
  {
    id: 'nfl_draft_2020',
    question: 'Who was selected #1 overall in the 2020 NFL Draft?',
    answer: 'Joe Burrow',
    acceptable_answers: ['Joe Burrow', 'Burrow'],
    point_value: 2,
    metadata: { year: 2020, category: 'draft' },
  },
  {
    id: 'nfl_draft_2021',
    question: 'Who was selected #1 overall in the 2021 NFL Draft?',
    answer: 'Trevor Lawrence',
    acceptable_answers: ['Trevor Lawrence', 'Lawrence', 'Trevor'],
    point_value: 2,
    metadata: { year: 2021, category: 'draft' },
  },
  {
    id: 'nfl_draft_2022',
    question: 'Who was selected #1 overall in the 2022 NFL Draft?',
    answer: 'Travon Walker',
    acceptable_answers: ['Travon Walker', 'Walker'],
    point_value: 2,
    metadata: { year: 2022, category: 'draft' },
  },
  {
    id: 'nfl_draft_2023',
    question: 'Who was selected #1 overall in the 2023 NFL Draft?',
    answer: 'Bryce Young',
    acceptable_answers: ['Bryce Young', 'Young', 'Bryce'],
    point_value: 2,
    metadata: { year: 2023, category: 'draft' },
  },
  {
    id: 'nfl_draft_2024',
    question: 'Who was selected #1 overall in the 2024 NFL Draft?',
    answer: 'Caleb Williams',
    acceptable_answers: ['Caleb Williams', 'Williams', 'Caleb'],
    point_value: 1,
    metadata: { year: 2024, category: 'draft' },
  },

  // NFL MVPs (2010-2024)
  {
    id: 'nfl_mvp_2010',
    question: 'Who won the NFL MVP award for the 2010 season?',
    answer: 'Tom Brady',
    acceptable_answers: ['Tom Brady', 'Brady'],
    point_value: 2,
    metadata: { year: 2010, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2011',
    question: 'Who won the NFL MVP award for the 2011 season?',
    answer: 'Aaron Rodgers',
    acceptable_answers: ['Aaron Rodgers', 'Rodgers'],
    point_value: 2,
    metadata: { year: 2011, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2012',
    question: 'Who won the NFL MVP award for the 2012 season?',
    answer: 'Adrian Peterson',
    acceptable_answers: ['Adrian Peterson', 'Peterson', 'AP', 'AD'],
    point_value: 2,
    metadata: { year: 2012, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2013',
    question: 'Who won the NFL MVP award for the 2013 season?',
    answer: 'Peyton Manning',
    acceptable_answers: ['Peyton Manning', 'Manning', 'Peyton'],
    point_value: 2,
    metadata: { year: 2013, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2014',
    question: 'Who won the NFL MVP award for the 2014 season?',
    answer: 'Aaron Rodgers',
    acceptable_answers: ['Aaron Rodgers', 'Rodgers'],
    point_value: 2,
    metadata: { year: 2014, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2015',
    question: 'Who won the NFL MVP award for the 2015 season?',
    answer: 'Cam Newton',
    acceptable_answers: ['Cam Newton', 'Newton', 'Cam'],
    point_value: 2,
    metadata: { year: 2015, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2016',
    question: 'Who won the NFL MVP award for the 2016 season?',
    answer: 'Matt Ryan',
    acceptable_answers: ['Matt Ryan', 'Ryan', 'Matty Ice'],
    point_value: 2,
    metadata: { year: 2016, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2017',
    question: 'Who won the NFL MVP award for the 2017 season?',
    answer: 'Tom Brady',
    acceptable_answers: ['Tom Brady', 'Brady'],
    point_value: 2,
    metadata: { year: 2017, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2018',
    question: 'Who won the NFL MVP award for the 2018 season?',
    answer: 'Patrick Mahomes',
    acceptable_answers: ['Patrick Mahomes', 'Mahomes'],
    point_value: 2,
    metadata: { year: 2018, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2019',
    question: 'Who won the NFL MVP award for the 2019 season?',
    answer: 'Lamar Jackson',
    acceptable_answers: ['Lamar Jackson', 'Jackson', 'Lamar'],
    point_value: 2,
    metadata: { year: 2019, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2020',
    question: 'Who won the NFL MVP award for the 2020 season?',
    answer: 'Aaron Rodgers',
    acceptable_answers: ['Aaron Rodgers', 'Rodgers'],
    point_value: 2,
    metadata: { year: 2020, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2021',
    question: 'Who won the NFL MVP award for the 2021 season?',
    answer: 'Aaron Rodgers',
    acceptable_answers: ['Aaron Rodgers', 'Rodgers'],
    point_value: 2,
    metadata: { year: 2021, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2022',
    question: 'Who won the NFL MVP award for the 2022 season?',
    answer: 'Patrick Mahomes',
    acceptable_answers: ['Patrick Mahomes', 'Mahomes'],
    point_value: 2,
    metadata: { year: 2022, category: 'mvp' },
  },
  {
    id: 'nfl_mvp_2023',
    question: 'Who won the NFL MVP award for the 2023 season?',
    answer: 'Lamar Jackson',
    acceptable_answers: ['Lamar Jackson', 'Jackson', 'Lamar'],
    point_value: 2,
    metadata: { year: 2023, category: 'mvp' },
  },

  // Memorable Moments
  {
    id: 'nfl_moment_beast_quake',
    question: "Which running back had the famous 'Beast Quake' run in the 2010 playoffs?",
    answer: 'Marshawn Lynch',
    acceptable_answers: ['Marshawn Lynch', 'Lynch', 'Beast Mode'],
    point_value: 2,
    metadata: { year: 2010, category: 'memorable_moment' },
  },
  {
    id: 'nfl_moment_helmet_catch_team',
    question: "In Super Bowl XLII, which Giants receiver made the famous 'Helmet Catch'?",
    answer: 'David Tyree',
    acceptable_answers: ['David Tyree', 'Tyree'],
    point_value: 3,
    metadata: { year: 2007, category: 'memorable_moment' },
  },
  {
    id: 'nfl_moment_28_3',
    question: 'In Super Bowl LI, the Patriots overcame a 28-3 deficit to beat which team?',
    answer: 'Atlanta Falcons',
    acceptable_answers: ['Atlanta Falcons', 'Falcons', 'Atlanta', 'ATL'],
    point_value: 1,
    metadata: { year: 2016, category: 'memorable_moment' },
  },
  {
    id: 'nfl_moment_philly_special',
    question: 'What was the name of the famous trick play the Eagles ran in Super Bowl LII?',
    answer: 'Philly Special',
    acceptable_answers: ['Philly Special', 'The Philly Special'],
    point_value: 2,
    metadata: { year: 2017, category: 'memorable_moment' },
  },
  {
    id: 'nfl_moment_minneapolis_miracle',
    question:
      "Which Vikings receiver caught the 'Minneapolis Miracle' touchdown pass in the 2017 playoffs?",
    answer: 'Stefon Diggs',
    acceptable_answers: ['Stefon Diggs', 'Diggs'],
    point_value: 2,
    metadata: { year: 2017, category: 'memorable_moment' },
  },
  {
    id: 'nfl_moment_double_doink',
    question: "Which Bears kicker hit the 'Double Doink' in the 2018 NFC Wild Card game?",
    answer: 'Cody Parkey',
    acceptable_answers: ['Cody Parkey', 'Parkey'],
    point_value: 3,
    metadata: { year: 2018, category: 'memorable_moment' },
  },
  {
    id: 'nfl_moment_mahomes_no_look',
    question: "Which quarterback is famous for his 'no-look passes'?",
    answer: 'Patrick Mahomes',
    acceptable_answers: ['Patrick Mahomes', 'Mahomes'],
    point_value: 1,
    metadata: { year: 2018, category: 'memorable_moment' },
  },
  {
    id: 'nfl_moment_brady_retirement',
    question: 'In what year did Tom Brady officially retire from the NFL?',
    answer: '2023',
    acceptable_answers: ['2023'],
    point_value: 2,
    metadata: { year: 2023, category: 'memorable_moment' },
  },
  {
    id: 'nfl_moment_superbowl_blackout',
    question: 'Which Super Bowl had a 34-minute power outage during the game?',
    answer: 'Super Bowl XLVII',
    acceptable_answers: ['Super Bowl XLVII', 'XLVII', '47', 'Super Bowl 47'],
    point_value: 3,
    metadata: { year: 2012, category: 'memorable_moment' },
  },
  {
    id: 'nfl_moment_deflategate',
    question: "Which quarterback was suspended 4 games for 'Deflategate'?",
    answer: 'Tom Brady',
    acceptable_answers: ['Tom Brady', 'Brady'],
    point_value: 2,
    metadata: { year: 2015, category: 'memorable_moment' },
  },

  // Records
  {
    id: 'nfl_record_peyton_tds',
    question: 'Who holds the record for most passing touchdowns in a single season with 55?',
    answer: 'Peyton Manning',
    acceptable_answers: ['Peyton Manning', 'Manning', 'Peyton'],
    point_value: 2,
    metadata: { year: 2013, category: 'record' },
  },
  {
    id: 'nfl_record_peterson_yards',
    question: 'In 2012, which running back rushed for 2,097 yards, the second-most in NFL history?',
    answer: 'Adrian Peterson',
    acceptable_answers: ['Adrian Peterson', 'Peterson', 'AP', 'AD'],
    point_value: 2,
    metadata: { year: 2012, category: 'record' },
  },
  {
    id: 'nfl_record_calvin_receiving',
    question: 'Who set the single-season receiving yards record with 1,964 yards in 2012?',
    answer: 'Calvin Johnson',
    acceptable_answers: ['Calvin Johnson', 'Johnson', 'Megatron'],
    point_value: 2,
    metadata: { year: 2012, category: 'record' },
  },
  {
    id: 'nfl_record_brady_rings',
    question: 'Which quarterback has the most Super Bowl wins with 7?',
    answer: 'Tom Brady',
    acceptable_answers: ['Tom Brady', 'Brady'],
    point_value: 1,
    metadata: { year: 2020, category: 'record' },
  },
  {
    id: 'nfl_record_mahomes_youngest_mvp',
    question:
      'In 2018, who became the youngest quarterback to win both NFL MVP and Super Bowl MVP?',
    answer: 'Patrick Mahomes',
    acceptable_answers: ['Patrick Mahomes', 'Mahomes'],
    point_value: 2,
    metadata: { year: 2018, category: 'record' },
  },
  {
    id: 'nfl_record_kupp_triple_crown',
    question: 'Which receiver won the receiving triple crown (yards, receptions, TDs) in 2021?',
    answer: 'Cooper Kupp',
    acceptable_answers: ['Cooper Kupp', 'Kupp'],
    point_value: 2,
    metadata: { year: 2021, category: 'record' },
  },
  {
    id: 'nfl_record_henry_derrick',
    question: 'Which running back rushed for 2,000+ yards in the 2020 season?',
    answer: 'Derrick Henry',
    acceptable_answers: ['Derrick Henry', 'Henry', 'King Henry'],
    point_value: 2,
    metadata: { year: 2020, category: 'record' },
  },
  {
    id: 'nfl_record_marino_broken',
    question:
      "In 2011, which three quarterbacks broke Dan Marino's single-season passing yards record?",
    answer: 'Drew Brees',
    acceptable_answers: [
      'Drew Brees',
      'Brees',
      'Tom Brady',
      'Brady',
      'Matthew Stafford',
      'Stafford',
    ],
    point_value: 3,
    metadata: { year: 2011, category: 'record' },
  },
];

/**
 * Main function to merge curated questions with generated ones
 */
async function main() {
  const questionsPath = path.join(__dirname, '..', 'trivia', 'nflQuestions.json');

  // Read existing questions
  let existingQuestions = [];
  try {
    const content = fs.readFileSync(questionsPath, 'utf-8');
    existingQuestions = JSON.parse(content);
    console.log(`Read ${existingQuestions.length} existing questions`);
  } catch (error) {
    console.log('No existing questions file found, starting fresh');
  }

  // Create a set of existing IDs to avoid duplicates
  const existingIds = new Set(existingQuestions.map((q) => q.id));

  // Add curated questions that don't already exist
  let added = 0;
  for (const question of CURATED_QUESTIONS) {
    if (!existingIds.has(question.id)) {
      existingQuestions.push(question);
      added++;
    }
  }

  console.log(`Added ${added} new curated questions`);
  console.log(`Total questions: ${existingQuestions.length}`);

  // Sort by year then category
  existingQuestions.sort((a, b) => {
    const yearA = a.metadata?.year || 0;
    const yearB = b.metadata?.year || 0;
    if (yearA !== yearB) return yearA - yearB;

    const catA = a.metadata?.category || '';
    const catB = b.metadata?.category || '';
    return catA.localeCompare(catB);
  });

  // Write back
  fs.writeFileSync(questionsPath, JSON.stringify(existingQuestions, null, 2));
  console.log(`\nWritten to: ${questionsPath}`);

  // Summary by category
  const categories = {};
  for (const q of existingQuestions) {
    const cat = q.metadata?.category || 'unknown';
    categories[cat] = (categories[cat] || 0) + 1;
  }

  console.log('\n=== Questions by Category ===');
  for (const [cat, count] of Object.entries(categories).sort()) {
    console.log(`  ${cat}: ${count}`);
  }
}

main().catch(console.error);
