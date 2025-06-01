#!/usr/bin/env python3
"""
Analyze WPFL History Excel file and generate insights
"""
import pandas as pd
import json
import sys
from pathlib import Path

def analyze_wpfl_history(file_path):
    """Analyze the WPFL history Excel file"""
    print(f"Reading Excel file: {file_path}")
    
    try:
        # First, check what sheets are available
        excel_file = pd.ExcelFile(file_path)
        print(f"Available sheets: {excel_file.sheet_names}")
        
        insights = {
            "sheets": excel_file.sheet_names,
            "sheet_analysis": {}
        }
        
        # Analyze each sheet
        for sheet_name in excel_file.sheet_names[:5]:  # Limit to first 5 sheets
            print(f"\nAnalyzing sheet: {sheet_name}")
            try:
                # Read the sheet with limited rows first
                df = pd.read_excel(file_path, sheet_name=sheet_name, nrows=100)
                
                sheet_info = {
                    "shape": list(df.shape),
                    "columns": list(df.columns),
                    "non_null_counts": df.count().to_dict(),
                    "sample_data": {}
                }
                
                # Get sample data from non-empty columns
                for col in df.columns:
                    if df[col].notna().sum() > 0:
                        sample = df[col].dropna().head(5).tolist()
                        if sample:
                            sheet_info["sample_data"][str(col)] = sample
                
                # Try to identify data patterns
                sheet_info["data_patterns"] = identify_patterns(df)
                
                insights["sheet_analysis"][sheet_name] = sheet_info
                
            except Exception as e:
                print(f"Error analyzing sheet {sheet_name}: {e}")
                insights["sheet_analysis"][sheet_name] = {"error": str(e)}
        
        # Output insights as JSON for the JavaScript to process
        print("\n=== INSIGHTS JSON START ===")
        print(json.dumps(insights, indent=2, default=str))
        print("=== INSIGHTS JSON END ===")
        
        return insights
        
    except Exception as e:
        print(f"Error reading Excel file: {e}")
        return {"error": str(e)}

def identify_patterns(df):
    """Identify patterns in the dataframe"""
    patterns = {}
    
    # Check for year columns
    year_cols = [col for col in df.columns if str(col).isdigit() and 2000 <= int(str(col)) <= 2030]
    if year_cols:
        patterns["year_columns"] = year_cols
    
    # Check for owner names
    possible_owners = []
    for col in df.columns:
        if df[col].dtype == 'object':
            unique_vals = df[col].dropna().unique()
            if 5 <= len(unique_vals) <= 20:  # Reasonable number for owners
                # Check if values look like names
                if any(isinstance(val, str) and ' ' not in str(val) and len(str(val)) < 20 for val in unique_vals[:5]):
                    possible_owners.extend(unique_vals[:10])
    
    if possible_owners:
        patterns["possible_owners"] = list(set(str(o) for o in possible_owners if pd.notna(o)))[:15]
    
    # Check for numeric data that could be scores
    numeric_cols = df.select_dtypes(include=['float64', 'int64']).columns
    for col in numeric_cols:
        values = df[col].dropna()
        if len(values) > 0:
            min_val = values.min()
            max_val = values.max()
            mean_val = values.mean()
            
            # Fantasy scores typically range from 50-200 per week
            if 0 <= min_val <= 100 and 50 <= max_val <= 250 and 50 <= mean_val <= 150:
                if "possible_weekly_scores" not in patterns:
                    patterns["possible_weekly_scores"] = []
                patterns["possible_weekly_scores"].append({
                    "column": str(col),
                    "min": float(min_val),
                    "max": float(max_val),
                    "mean": float(mean_val)
                })
            # Season totals typically range from 1000-2000
            elif 500 <= min_val <= 2500 and 1000 <= max_val <= 3000:
                if "possible_season_totals" not in patterns:
                    patterns["possible_season_totals"] = []
                patterns["possible_season_totals"].append({
                    "column": str(col),
                    "min": float(min_val),
                    "max": float(max_val),
                    "mean": float(mean_val)
                })
    
    return patterns

if __name__ == "__main__":
    file_path = Path(__file__).parent / "data" / "WPFLHistory.xlsx"
    if file_path.exists():
        analyze_wpfl_history(file_path)
    else:
        print(f"File not found: {file_path}")
        sys.exit(1)