plan "House with a utility" walls 0.2/0.1

room living "Living room" living rect 0,0 4x4 habitable
room kitchen "Kitchen" kitchen rect 4,0 3x2.5 habitable
room utility "Utility" utility rect 4,2.5 3x1.5
outdoor yard "Yard" rect 0,4 7x4

door living.west w0.9 entrance
door living>kitchen at 4,1.25 w0.9
door kitchen>utility at 5.5,2.5 w0.8
door utility>yard w0.9 on:utility.south
window kitchen.north w1.2
window living.north w1.5
