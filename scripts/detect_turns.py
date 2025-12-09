
import json
import math
import sys

def calculate_heading(p1, p2):
    return math.atan2(p2[1] - p1[1], p2[0] - p1[0])

def normalize_angle(angle):
    while angle > math.pi:
        angle -= 2 * math.pi
    while angle < -math.pi:
        angle += 2 * math.pi
    return angle

def detect_turns(json_path):
    with open(json_path, 'r') as f:
        data = json.load(f)

    # Assuming 'full' configuration is index 0
    config = data['configurations'][0]
    track_path = config['trackPath'] # [[lat, lon], ...]
    
    if not track_path or len(track_path) < 10:
        print("Not enough track data to detect turns.", file=sys.stderr)
        return

    # Center
    lats = [p[0] for p in track_path]
    lons = [p[1] for p in track_path]
    center_lat = sum(lats) / len(lats)
    center_lon = sum(lons) / len(lons)
    
    lat_scale = 111000
    lon_scale = 111000 * math.cos(math.radians(center_lat))
    
    points = []
    for lat, lon in track_path:
        x = (lon - center_lon) * lon_scale
        y = (lat - center_lat) * lat_scale
        points.append([x, y])

    # Calculate Curvature
    # We'll use a sliding window to smooth out noise
    window_size = 20
    curvatures = []
    
    for i in range(len(points)):
        # Get points in window
        idx_prev = i - window_size if i >= window_size else i - window_size + len(points)
        idx_next = (i + window_size) % len(points)
        
        p1 = points[idx_prev]
        p2 = points[i]
        p3 = points[idx_next]
        
        # Vector 1
        v1 = [p2[0] - p1[0], p2[1] - p1[1]]
        # Vector 2
        v2 = [p3[0] - p2[0], p3[1] - p2[1]]
        
        angle1 = math.atan2(v1[1], v1[0])
        angle2 = math.atan2(v2[1], v2[0])
        
        angle_diff = normalize_angle(angle2 - angle1)
        
        # Distance approx
        dist_v1 = math.sqrt(v1[0]**2 + v1[1]**2)
        dist_v2 = math.sqrt(v2[0]**2 + v2[1]**2)
        dist = dist_v1 + dist_v2
        
        if dist > 0:
            curvature = abs(angle_diff) / dist
        else:
            curvature = 0
            
        curvatures.append(curvature)
        
    # Find Peaks (Local Maxima)
    # Mean and Stdev manual calc
    mean_curv = sum(curvatures) / len(curvatures)
    variance = sum([((x - mean_curv) ** 2) for x in curvatures]) / len(curvatures)
    std_dev = math.sqrt(variance)
    
    threshold = mean_curv + 0.5 * std_dev
    
    # Smooth curvature (Simple moving average)
    smooth_curvatures = []
    smooth_window = 10
    for i in range(len(curvatures)):
        val = 0
        for j in range(smooth_window):
            idx = (i + j - smooth_window // 2) % len(curvatures)
            val += curvatures[idx]
        smooth_curvatures.append(val / smooth_window)
    
    min_peak_dist = 50 # indices
    
    candidate_peaks = []
    for i in range(len(smooth_curvatures)):
        prev = smooth_curvatures[i-1] 
        curr = smooth_curvatures[i]
        next_val = smooth_curvatures[(i+1) % len(smooth_curvatures)]
        
        if curr > threshold and curr > prev and curr > next_val:
            candidate_peaks.append(i)

    # Filter close peaks (keep highest)
    final_peaks = []
    if candidate_peaks:
        # Sort by strength
        candidate_peaks.sort(key=lambda idx: smooth_curvatures[idx], reverse=True)
        
        used_indices = set()
        
        for idx in candidate_peaks:
            is_close = False
            for used in used_indices:
                # Handle wrap around distance
                d1 = abs(idx - used)
                d2 = len(points) - d1
                dist = min(d1, d2)
                
                if dist < min_peak_dist:
                    is_close = True
                    break
            
            if not is_close:
                final_peaks.append(idx)
                used_indices.add(idx)
                
    final_peaks.sort()
    
    print(f"Detected {len(final_peaks)} turns.", file=sys.stderr)
    
    # Map to Sectors
    sectors = config['sectors']
    
    for i in range(min(len(sectors), len(final_peaks))):
        idx = final_peaks[i]
        lat_lon = track_path[idx]
        
        # Update sector
        sectors[i]['coordinates'] = {
            "latitude": lat_lon[0],
            "longitude": lat_lon[1]
        }
    
    # Write back
    with open(json_path, 'w') as f:
        json.dump(data, f, indent=2)
        
    print("Updated sector coordinates.", file=sys.stderr)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python detect_turns.py <json_file>")
        sys.exit(1)
        
    detect_turns(sys.argv[1])
