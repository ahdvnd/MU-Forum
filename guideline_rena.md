calculateEngagementScore(student, talkDecile, breakoutDecile) {
    // Calculate a composite engagement score from various metrics
    
    // Focus percentage
    const focusPercentage = student['window-focus-percentage'] || student.windowFocusPercentage || 0;
    
    // Talk time percentile
    const talkTimePercentile = this.extractPercentileValue(talkDecile);

    
    // Breakout talk time percentile
    const breakoutPercentile = this.extractPercentileValue(breakoutDecile);
    
    // Activity metrics (10% weight)
    const reactions = student.reactions || 0;
    const handRaises = student['hand-raises'] || student.handRaises || 0;
    const chatMessages = student['chat-messages'] || student.chatMessages || 0;
    const isAbsent = student.absent || student.isAbsent || false;
    
    //Full Stats Data
    const stats = {
    	focusPercent: parseFloat(focusPercentage),
    	breakoutTalkPercentile: parseFloat(breakoutPercentile), 
    	handRaises: parseInt(handRaises, 10),
    	totalTalkPercentile: parseFloat(talkTimePercentile), 
    	reactions: parseInt(reactions, 10),           
    	chatMessages: parseInt(chatMessages, 10),    
    	isAbsent: isAbsent
   	 };

	// Rubric Logic
  
  	// Check for Score 0 (No Evidence):
  	// IF absent OR (focus < 5% AND breakout < 5th %ile AND 0 reactions AND 0 chats)
  	if (stats.isAbsent || 
      	   (stats.focusPercent < 5 && 
           stats.breakoutTalkPercentile < 5 && 
           stats.reactions === 0 && 
           stats.chatMessages === 0)) 
 	{
    	return 0;
  	}
  
  	// Check for Score 1 (Passive):
 	// IF focus % < 15% AND breakout talk time < 10th %ile
 	if ((stats.focusPercent < 15 && stats.breakoutTalkPercentile < 10) &&
	   (stats.reactions === 0 && stats.chatMessages === 0))
	{
    	return 1;
  	}
  
  	// Check for Max Score 2 (Limited):
  	// IF focus % < 30% OR breakout < 20th %ile OR 0 reactions
  	if (stats.focusPercent < 30 || 
      	   stats.breakoutTalkPercentile < 20 || 
           stats.reactions === 0) 
  	{
    	return 2;
  	}
  
  	// Check for Max Score 3 (Consistent):
  	// ELSE IF focus % < 50% OR number of hand raises == 0 OR total talk time < 40th  OR breakout < 40th %ile
  	if (stats.focusPercent < 50 || 
	   stats.handRaises === 0 || 
	   stats.totalTalkPercentile < 40 ||
	   stats.breakoutTalkPercentile < 30) 	{
    	return 3;
 	 }
  
  	// Default to Score 4 (Proactive):
  	// (If a student passes all the caps for scores 1-3, they default to 4).
  	return 4;
  	}