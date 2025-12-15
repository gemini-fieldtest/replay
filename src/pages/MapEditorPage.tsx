import React, { useEffect, useState, useRef, useMemo } from 'react';

interface Point {
    name: string;
    lat: number;
    long: number;
    verified?: boolean;
}

interface Segment {
    id: string;
    startPoint: string; // name of point
    endPoint: string;   // name of point
    type: 'straight' | 'corner';
}

interface TrackData {
    points: Point[];
    segments?: Segment[];
}

export function MapEditorPage() {
    const [trackPath, setTrackPath] = useState<{ lat: number, long: number }[]>([]);
    const [trackData, setTrackData] = useState<TrackData>({ points: [] });
    const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });

    // Interaction State
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [dragPointIndex, setDragPointIndex] = useState<number | null>(null);
    const [segmentStartIdx, setSegmentStartIdx] = useState<number | null>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 1. Fetch Data
    useEffect(() => {
        const loadData = async () => {
            try {
                // Load KML
                const kmlRes = await fetch('/tracks/thunderhill/track.kml');
                const kmlText = await kmlRes.text();
                const parser = new DOMParser();
                const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
                const coordinatesText = kmlDoc.querySelector('LineString coordinates')?.textContent;

                if (coordinatesText) {
                    const coords = coordinatesText.trim().split(/\s+/).map(pair => {
                        const [long, lat] = pair.split(',').map(Number);
                        return { lat, long };
                    });
                    setTrackPath(coords);
                }

                // Load Points
                const pointsRes = await fetch('/tracks/thunderhill/points.json');
                const pointsJson = await pointsRes.json();
                // Ensure structure
                if (Array.isArray(pointsJson)) {
                    setTrackData({ points: pointsJson, segments: [] });
                } else {
                    setTrackData(pointsJson);
                }

            } catch (e) {
                console.error("Failed to load map data", e);
            }
        };
        loadData();
    }, []);

    // Helper: Projection (Simple Equirectangular approximation for small area is fine, or just scale relative to bounds)
    // Let's use relative scaling to fit the canvas.
    const bounds = useMemo(() => {
        if (trackPath.length === 0) return null;
        let minLat = Infinity, maxLat = -Infinity, minLong = Infinity, maxLong = -Infinity;
        trackPath.forEach(p => {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.long < minLong) minLong = p.long;
            if (p.long > maxLong) maxLong = p.long;
        });
        return { minLat, maxLat, minLong, maxLong };
    }, [trackPath]);

    const project = (lat: number, long: number, width: number, height: number) => {
        if (!bounds) return { x: 0, y: 0 };
        const latRange = bounds.maxLat - bounds.minLat;
        const longRange = bounds.maxLong - bounds.minLong;

        // Scale to fit
        const scaleX = (width - 100) / longRange;
        const scaleY = (height - 100) / latRange;
        const finalScale = Math.min(scaleX, scaleY) * scale;

        const x = (long - bounds.minLong) * finalScale + 50 + offset.x;
        const y = height - ((lat - bounds.minLat) * finalScale + 50) + offset.y; // Invert Y for latitude

        return { x, y, k: finalScale }; // Return scale for hit testing
    };

    const inverseProject = (x: number, y: number, width: number, height: number) => {
        if (!bounds) return { lat: 0, long: 0 };
        const latRange = bounds.maxLat - bounds.minLat;
        const longRange = bounds.maxLong - bounds.minLong;

        const scaleX = (width - 100) / longRange;
        const scaleY = (height - 100) / latRange;
        const finalScale = Math.min(scaleX, scaleY) * scale;

        const long = (x - 50 - offset.x) / finalScale + bounds.minLong;
        const lat = bounds.minLat + (height - y + offset.y - 50) / finalScale; // Approximate due to Y inversion logic check needed
        // Re-verify Y logic: y = H - (latTerm + 50) + offY  => y - offY - H = -(latTerm + 50) => H - y + offY = latTerm + 50 => latTerm = H - y + offY - 50
        // Wait, my y formula above was: y = height - ((...) + 50) + offset.y
        // So: y - offset.y = height - (latTerm + 50)
        // (latTerm + 50) = height - (y - offset.y)
        // latTerm = height - y + offset.y - 50
        // lat = latTerm / finalScale + bounds.minLat

        const latTerm = height - y + offset.y - 50;
        const finalLat = latTerm / finalScale + bounds.minLat;

        return { lat: finalLat, long };
    };


    // Draw
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !bounds) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { width, height } = canvas.getBoundingClientRect();
        canvas.width = width;
        canvas.height = height;

        ctx.clearRect(0, 0, width, height);

        // Draw Track
        if (trackPath.length > 0) {
            ctx.beginPath();
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 2;
            const start = project(trackPath[0].lat, trackPath[0].long, width, height);
            ctx.moveTo(start.x, start.y);
            for (let i = 1; i < trackPath.length; i++) {
                const p = project(trackPath[i].lat, trackPath[i].long, width, height);
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }

        // Draw Segments
        if (trackData.segments) {
            ctx.lineWidth = 4;
            trackData.segments.forEach(seg => {
                const startP = trackData.points.find(p => p.name === seg.startPoint);
                const endP = trackData.points.find(p => p.name === seg.endPoint);
                if (startP && endP) {
                    const startPos = project(startP.lat, startP.long, width, height);
                    const endPos = project(endP.lat, endP.long, width, height);

                    ctx.beginPath();
                    ctx.strokeStyle = seg.type === 'straight' ? '#10b981' : '#f59e0b'; // Green or Amber
                    ctx.moveTo(startPos.x, startPos.y);
                    ctx.lineTo(endPos.x, endPos.y);
                    ctx.stroke();

                    // Label
                    const midX = (startPos.x + endPos.x) / 2;
                    const midY = (startPos.y + endPos.y) / 2;
                    ctx.fillStyle = '#000';
                    ctx.font = 'bold 12px sans-serif';
                    ctx.fillText(seg.id || seg.type, midX, midY);
                }
            });
        }

        // Draw Points
        trackData.points.forEach((p, i) => {
            const pos = project(p.lat, p.long, width, height);

            ctx.beginPath();
            if (i === selectedPointIndex) {
                ctx.fillStyle = '#ff00ff'; // Selection color (Magenta)
            } else if (i === segmentStartIdx) {
                ctx.fillStyle = '#0ff'; // Segment start (Cyan)
            } else if (p.verified) {
                ctx.fillStyle = '#10b981'; // Verified = Green
            } else {
                ctx.fillStyle = '#ef4444'; // Unverified = Red
            }
            ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#000';
            ctx.font = '10px sans-serif';
            ctx.fillText(p.name, pos.x + 8, pos.y + 3);
        });

    }, [trackPath, trackData, bounds, scale, offset, selectedPointIndex, segmentStartIdx]);



    // Handlers
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const zoomSensitivity = 0.001;
        const newScale = Math.max(0.1, Math.min(10, scale - e.deltaY * zoomSensitivity));
        setScale(newScale);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check hit on points
        let hitIndex: number | null = null;
        const { width, height } = rect;

        // We need to re-calculate projection for hit test. 
        // Ideally we'd memoize projected points but for <200 points it's fast enough to re-calc.
        trackData.points.forEach((p, i) => {
            const pos = project(p.lat, p.long, width, height);
            const dx = pos.x - x;
            const dy = pos.y - y;
            if (dx * dx + dy * dy < 100) { // 10px radius squared
                hitIndex = i;
            }
        });

        if (hitIndex !== null) {
            setSelectedPointIndex(hitIndex);
            setDragPointIndex(hitIndex);
            setIsDragging(true);
        } else {
            setIsDragging(true);
            setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;

        if (dragPointIndex !== null) {
            // Dragging a point
            const rect = canvasRef.current!.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const { lat, long } = inverseProject(x, y, rect.width, rect.height);

            // Snap to track path? (Optional, maybe later)
            // For now just move free

            const newPoints = [...trackData.points];
            newPoints[dragPointIndex] = { ...newPoints[dragPointIndex], lat, long };
            setTrackData({ ...trackData, points: newPoints });

        } else {
            // Panning
            setOffset({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        setDragPointIndex(null);
    };

    // Segment Logic
    const toggleSegmentStart = () => {
        if (selectedPointIndex !== null) {
            if (segmentStartIdx === selectedPointIndex) {
                setSegmentStartIdx(null);
            } else {
                setSegmentStartIdx(selectedPointIndex);
            }
        }
    };

    const createSegment = (type: 'straight' | 'corner') => {
        if (segmentStartIdx !== null && selectedPointIndex !== null && segmentStartIdx !== selectedPointIndex) {
            const startPoint = trackData.points[segmentStartIdx].name;
            const endPoint = trackData.points[selectedPointIndex].name;

            const newSegment: Segment = {
                id: `${type}-${trashId++}`,
                startPoint,
                endPoint,
                type
            };

            setTrackData({
                ...trackData,
                segments: [...(trackData.segments || []), newSegment]
            });
            setSegmentStartIdx(null);
        }
    };

    // Dumb unique id gen for session
    let trashId = Date.now();

    const autoSortAndRenumber = () => {
        if (trackPath.length === 0 || trackData.points.length === 0) return;

        // 1. Sort points by nearest index on track path
        const sortedPoints = [...trackData.points].sort((a, b) => {
            const idxA = getNearestPathIndex(a, trackPath);
            const idxB = getNearestPathIndex(b, trackPath);
            return idxA - idxB;
        });

        // 2. Renumber unverified
        const renumberedPoints = sortedPoints.map((p, i) => {
            if (p.verified) return p;

            // Sequential naming for unverified
            return {
                ...p,
                name: `Pt ${i + 1}`
            };
        });

        setTrackData(prev => ({ ...prev, points: renumberedPoints }));
    };

    const getNearestPathIndex = (p: Point, path: { lat: number, long: number }[]) => {
        let minInfo = { dist: Infinity, idx: -1 };
        path.forEach((node, i) => {
            const d = (p.lat - node.lat) ** 2 + (p.long - node.long) ** 2;
            if (d < minInfo.dist) minInfo = { dist: d, idx: i };
        });
        return minInfo.idx;
    };
    const deleteSelectedPoint = () => {
        if (selectedPointIndex !== null) {
            const newPoints = trackData.points.filter((_, i) => i !== selectedPointIndex);
            setTrackData({ ...trackData, points: newPoints });
            setSelectedPointIndex(null);
            setSegmentStartIdx(null);
        }
    };

    const addNewPoint = () => {
        // Add point at center of screen? or Click to add?
        // Let's just add at 0,0 relative or something visible.
        // Better: Add next to selected point or last point.
        const lastPoint = trackData.points[trackData.points.length - 1];
        if (lastPoint) {
            setTrackData({
                ...trackData,
                points: [...trackData.points, { name: 'New Point', lat: lastPoint.lat + 0.0001, long: lastPoint.long + 0.0001 }]
            });
        }
    };

    const saveData = async () => {
        try {
            const response = await fetch('/api/save-track', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(trackData),
            });

            if (response.ok) {
                alert("Track data saved successfully!");
            } else {
                alert("Failed to save track data.");
                console.error(await response.text());
            }
        } catch (error) {
            alert("Error saving track data.");
            console.error(error);
        }
    };

    return (
        <div className="flex h-screen bg-gray-100 overflow-hidden">
            {/* Sidebar */}
            <div className="w-80 bg-white border-r border-gray-200 flex flex-col shadow-lg z-10">
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                    <h2 className="font-bold text-lg mb-2">Map Editor</h2>
                    <div className="flex gap-2">
                        <button
                            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors flex-1"
                            onClick={saveData}
                        >
                            Save Data
                        </button>
                        <button
                            className="bg-purple-600 text-white px-3 py-1 rounded text-sm hover:bg-purple-700 transition-colors flex-1"
                            onClick={autoSortAndRenumber}
                        >
                            Sort & Renumber
                        </button>
                    </div>
                </div>

                {/* Selected Point Editor */}
                <div className="p-4 border-b border-gray-200 bg-white">
                    {selectedPointIndex !== null ? (
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Selected Point ({selectedPointIndex})</h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Name</label>
                                    <input
                                        className="border rounded px-2 py-1 w-full text-sm font-mono"
                                        value={trackData.points[selectedPointIndex].name}
                                        onChange={(e) => {
                                            const newPoints = [...trackData.points];
                                            newPoints[selectedPointIndex].name = e.target.value;
                                            setTrackData({ ...trackData, points: newPoints });
                                        }}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className="flex items-center gap-2 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            className="rounded text-green-600 focus:ring-green-500 h-4 w-4"
                                            checked={!!trackData.points[selectedPointIndex].verified}
                                            onChange={(e) => {
                                                const newPoints = [...trackData.points];
                                                newPoints[selectedPointIndex].verified = e.target.checked;
                                                setTrackData({ ...trackData, points: newPoints });
                                            }}
                                        />
                                        <span className="text-sm font-medium">Verified</span>
                                    </label>
                                    <button
                                        onClick={deleteSelectedPoint}
                                        className="text-red-500 hover:text-red-700 text-xs font-bold uppercase transition-colors"
                                    >
                                        Delete
                                    </button>
                                </div>
                                <div className="pt-2 border-t border-gray-100 grid grid-cols-2 gap-2">
                                    <button
                                        onClick={toggleSegmentStart}
                                        className={`px-2 py-1 rounded text-xs font-bold border ${segmentStartIdx === selectedPointIndex ? 'bg-cyan-100 border-cyan-500 text-cyan-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                                    >
                                        {segmentStartIdx === selectedPointIndex ? 'Cancel Segment' : 'Start Segment'}
                                    </button>
                                    {segmentStartIdx !== null && segmentStartIdx !== selectedPointIndex && (
                                        <div className="col-span-2 flex gap-1">
                                            <button
                                                onClick={() => createSegment('straight')}
                                                className="flex-1 bg-green-100 text-green-700 border border-green-200 rounded px-2 py-1 text-xs font-bold hover:bg-green-200"
                                            >
                                                + Straight
                                            </button>
                                            <button
                                                onClick={() => createSegment('corner')}
                                                className="flex-1 bg-amber-100 text-amber-700 border border-amber-200 rounded px-2 py-1 text-xs font-bold hover:bg-amber-200"
                                            >
                                                + Corner
                                            </button>
                                        </div>
                                    )}
                                    <div className="pt-2 border-t border-gray-100 text-xs text-gray-500 font-mono">
                                        <div className="flex justify-between">
                                            <span>Lat:</span>
                                            <span>{trackData.points[selectedPointIndex].lat.toFixed(6)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>Long:</span>
                                            <span>{trackData.points[selectedPointIndex].long.toFixed(6)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm text-gray-400 italic text-center py-4">
                            Select a point on the map or list to edit
                        </div>
                    )}
                </div>

                {/* Point List */}
                <div className="flex-1 overflow-y-auto">
                    <h3 className="px-4 py-2 text-xs font-bold text-gray-500 bg-gray-50 border-b border-gray-200 sticky top-0">
                        Points ({trackData.points.length})
                    </h3>
                    <ul>
                        {trackData.points.map((p, i) => (
                            <li
                                key={i}
                                onClick={() => setSelectedPointIndex(i)}
                                className={`px-4 py-2 border-b border-gray-100 cursor-pointer flex items-center justify-between text-sm hover:bg-gray-50 transition-colors ${selectedPointIndex === i ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400 font-mono text-xs w-6 text-right">{i}</span>
                                    <span className={`font-medium ${p.verified ? 'text-green-700' : 'text-gray-900'}`}>{p.name}</span>
                                </div>
                                {p.verified && (
                                    <div className="w-2 h-2 rounded-full bg-green-500" title="Verified" />
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Canvas Area */}
            <div className="flex-1 relative bg-gray-200 overflow-hidden" ref={containerRef}>
                <canvas
                    ref={canvasRef}
                    className="w-full h-full block cursor-crosshair touch-none"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                />

                {/* Overlay Controls */}
                <div className="absolute top-4 right-4 flex flex-col gap-2">
                    <div className="bg-white/90 backdrop-blur px-3 py-1.5 rounded shadow text-xs font-mono">
                        Scale: {scale.toFixed(2)}
                    </div>
                    <button
                        onClick={addNewPoint}
                        className="bg-white border-2 border-dashed border-blue-400 text-blue-600 px-3 py-1.5 rounded shadow hover:bg-blue-50 font-bold text-xs"
                    >
                        + Add Point
                    </button>
                </div>

                {/* Legend */}
                <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur p-2 rounded shadow text-[10px] space-y-1">
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /> Verified Point</div>
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" /> Unverified Point</div>
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-magenta-500" style={{ backgroundColor: '#ff00ff' }} /> Selected</div>
                    <div className="flex items-center gap-1"><div className="w-8 h-1 bg-green-500" style={{ opacity: 0.6 }} /> Straight</div>
                    <div className="flex items-center gap-1"><div className="w-8 h-1 bg-amber-500" style={{ opacity: 0.6 }} /> Corner</div>
                </div>
            </div >
        </div >
    );
}
