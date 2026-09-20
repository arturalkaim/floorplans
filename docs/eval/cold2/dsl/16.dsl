plan "House with Utility"

room kitchen "Kitchen" kitchen rect 0,0 4x4
room utility "Utility" utility rect 4,0 2x4
room living "Living Room" living rect 6,0 4x4
outdoor yard "Yard" rect 0,4 10x4

door utility>yard w0.9
door kitchen>utility w0.8 hinge:start swing:utility
door kitchen>living w0.9 hinge:start swing:living
