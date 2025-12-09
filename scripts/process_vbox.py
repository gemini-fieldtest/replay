
import csv
import json
import re
import sys

def dms_to_decimal(dms_str):
    """Parses VBOX coordinate format (e.g., '38°9.631176 N') to decimal degrees."""
    try:
        # Regex to capture degrees, minutes, and hemisphere
        match = re.match(r"(\d+)°([\d\.]+)\s+([NSEW])", dms_str)
        if not match:
            return None
        
        degrees = float(match.group(1))
        minutes = float(match.group(2))
        hemisphere = match.group(3)
        
        decimal = degrees + (minutes / 60.0)
        
        if hemisphere in ['S', 'W']:
            decimal = -decimal
            
        return decimal
    except Exception as e:
        print(f"Error parsing coordinate '{dms_str}': {e}", file=sys.stderr)
        return None

def process_vbox_csv(csv_path):
    track_path = []
    start_finish = None
    
    with open(csv_path, 'r', encoding='utf-8', errors='replace') as f:
        # Skip the first few lines if they contain metadata (VBOX files sometimes do)
        # But looking at the preview, line 1 is the header.
        reader = csv.DictReader(f)
        
        rows = list(reader)
        print(f"Total rows: {len(rows)}", file=sys.stderr)

        # Extract coordinates
        for i, row in enumerate(rows):
            lat_str = row.get('Latitude')
            lon_str = row.get('Longitude')
            
            if not lat_str or not lon_str:
                continue
                
            lat = dms_to_decimal(lat_str)
            lon = dms_to_decimal(lon_str)
            
            if lat is not None and lon is not None:
                # Downsample to avoid huge JSON files (e.g., take every 5th point)
                # But for high precision, maybe we keep more? 
                # Let's start with every point and see the size, or maybe every 5th if it's 60Hz data.
                # VBOX is usually 10Hz or 20Hz. If it's a 3 min lap at 20Hz -> 3600 points.
                # 3600 points is fine.
                track_path.append([lat, lon])

    if not track_path:
        print("No valid track path extracted.", file=sys.stderr)
        return None

    # Assuming the start of the file is the start/finish line for now, 
    # or we can take the first point.
    # The user said the CSV "has coordinates from the track".
    # Often these recordings start in the pits. 
    # We might need to filter for speed > 10km/h or something to get only the track part.
    
    # Filter out low speed points (pits/stopped)
    # The 'Speed (km/h)' column is what we need.
    
    clean_path = []
    for i, row in enumerate(rows):
        speed_str = row.get('Speed (km/h)')
        lat_str = row.get('Latitude')
        lon_str = row.get('Longitude')
        
        if not speed_str or not lat_str or not lon_str:
            continue
            
        try:
            speed = float(speed_str)
            if speed > 10.0: # Filter out very slow speeds
                 lat = dms_to_decimal(lat_str)
                 lon = dms_to_decimal(lon_str)
                 if lat is not None and lon is not None:
                     clean_path.append([lat, lon])
        except ValueError:
            continue

    if not clean_path:
        print("No valid track path after filtering.", file=sys.stderr)
        return None # Fallback to unfiltered if aggressive filtering fails

    # Extract start/finish from the first point of the lap.
    # ideally we find where the lap count increments, but standard VBOX CSVs 
    # might not have a simple 'CurrentLap' column that resets.
    # Let's look for "Lap" or similar in the header.
    # Headers seen: UTC time, Satellites, Speed (km/h), Heading (Degrees), Latitude, Longitude, ...
    # No explicit "Lap Number" column seen in the preview snippet.
    
    # We will use the full cleaned path as the reference lap for now.
    # We'll assume the recording is roughly one session.
    # We'll take the point with the highest speed as a reference? No.
    # We'll just define the start/finish as the first point of the clean path.
    
    start_finish_lat = clean_path[0][0]
    start_finish_lon = clean_path[0][1]
    
    # Estimate heading at start
    # atan2(dlon, dlat) roughly
    # But we can just use the heading column if available
    # "Heading (Degrees)"
    start_heading = 0
    try:
        start_heading = float(rows[0].get('Heading (Degrees)', 0))
    except:
        pass

    # Construct the JSON
    track_data = {
        "id": "thunderhill_east",
        "name": "Thunderhill Raceway Park (East)",
        "location": {
            "latitude": 39.540333,
            "longitude": -122.330694
        },
        "description": "3-mile, 15-turn road course in Willows, California.",
        "configurations": [
            {
                "id": "full",
                "name": "Full Course (East)",
                "lengthMiles": 2.866, # can calculate this from path
                "startFinishLine": {
                    "latitude": start_finish_lat,
                    "longitude": start_finish_lon,
                    "heading": start_heading
                },
                "trackPath": clean_path,
                "sectors": [
                    { "id": "1E", "name": "Turn 1", "coordinates": None },
                    { "id": "2E", "name": "Turn 2", "coordinates": None },
                    { "id": "3E", "name": "Turn 3", "coordinates": None },
                    { "id": "4E", "name": "Turn 4", "coordinates": None },
                    { "id": "5E", "name": "Turn 5 (Cyclone)", "coordinates": None },
                    { "id": "6E", "name": "Turn 6", "coordinates": None },
                    { "id": "7E", "name": "Turn 7", "coordinates": None },
                    { "id": "8E", "name": "Turn 8", "coordinates": None },
                    { "id": "9E", "name": "Turn 9", "coordinates": None },
                    { "id": "10E", "name": "Turn 10", "coordinates": None },
                    { "id": "11E", "name": "Turn 11", "coordinates": None },
                    { "id": "12E", "name": "Turn 12", "coordinates": None },
                    { "id": "13E", "name": "Turn 13", "coordinates": None },
                    { "id": "14E", "name": "Turn 14", "coordinates": None },
                    { "id": "15E", "name": "Turn 15", "coordinates": None }
                ]
            }
        ]
    }
    
    print(json.dumps(track_data, indent=2))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python process_vbox.py <csv_file>")
        sys.exit(1)
        
    process_vbox_csv(sys.argv[1])
