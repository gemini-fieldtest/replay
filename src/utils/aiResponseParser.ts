interface ParsedResponse {
  directive: string;
  analysis: string;
}

export const parseCoachResponse = (text: string): ParsedResponse => {
  // Common patterns for the output section
  // The model is prompted with "*Output:*" or "**Output:**" or numbered lists
  const outputPatterns = [
    /(?:\*|\s)*\**(?:Output|Coaching Directive|Directive)(?:\s*:\s*)\**"?/i,
    /\d+\.\s*(?:Output|Coaching Directive|Directive)(?:\s*:\s*)"?/i,
  ];

  let splitIndex = -1;
  let matchLength = 0;

  for (const pattern of outputPatterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      splitIndex = match.index;
      matchLength = match[0].length;
      break;
    }
  }

  if (splitIndex !== -1) {
    let analysis = text.substring(0, splitIndex).trim();
    // Get the directive part, remove trailing quotes if present
    let directive = text.substring(splitIndex + matchLength).trim();

    // Check if "Analysis" or "Reasoning" is embedded *after* the directive (Pro format)
    // Pattern: Directive: "..." ### Analysis: ...
    const secondaryAnalysisMatch = directive.match(
      /(?:###|\*\*|__)\s*(?:Analysis|Reasoning|Physics Diagnosis)(?:\s*:\s*)?(?:\*\*|__)?/i
    );
    if (secondaryAnalysisMatch && secondaryAnalysisMatch.index !== undefined) {
      // Strip the header itself from the extra content
      const extraAnalysis = directive
        .substring(
          secondaryAnalysisMatch.index + secondaryAnalysisMatch[0].length
        )
        .trim();
      directive = directive.substring(0, secondaryAnalysisMatch.index).trim();

      // Append the extra analysis to the main analysis (or replace if main was just status/empty)
      if (analysis) {
        analysis = `${analysis}\n\n${extraAnalysis}`;
      } else {
        analysis = extraAnalysis;
      }
    }

    // Remove trailing quote if it started with one (handled by pattern but good to be safe)
    // or if the text just ends with one
    if (directive.endsWith('"')) {
      directive = directive.slice(0, -1);
    }

    // Also remove leading quote if regex didn't catch it fully (sometimes it does)
    if (directive.startsWith('"')) {
      directive = directive.slice(1);
    }

    return {
      directive,
      analysis,
    };
  }

  // Fallback: If no explicit 'Output:' or 'Directive:' section found (Flash style usually has it),
  // Check if it's a "Directive -> Analysis" format (Pro style often lacks explicit "Directive:" label but has "Analysis")
  const analysisPattern =
    /(?:###|\*\*|__)\s*(?:Analysis|Reasoning|Physics Diagnosis|TELEMETRY ANALYSIS)(?:\s*:\s*)?(?:\*\*|__)?/i;
  const analysisMatch = text.match(analysisPattern);

  if (
    analysisMatch &&
    analysisMatch.index !== undefined &&
    analysisMatch.index > 0
  ) {
    // Logic: Everything before "Analysis" is the directive
    const directive = text.substring(0, analysisMatch.index).trim();
    // Everything *after* the match is the analysis content
    // We add the length of the match to the index to skip the header
    const analysisContent = text
      .substring(analysisMatch.index + analysisMatch[0].length)
      .trim();

    return {
      directive,
      analysis: analysisContent,
    };
  }

  return {
    directive: text,
    analysis: "",
  };
};
