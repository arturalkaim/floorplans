plan "Townhouse" stack ground,first

level ground "Ground Floor" ground
room hall "Hall" hall rect 2,0 1.5x4 circulation
room living "Living Room" living rect 3.5,0 4x4
room kitchen "Kitchen" kitchen rect 7.5,0 3x4

level first "First Floor" h2.6
room landing "Landing" hall rect 2,0 1.5x2 circulation
room bed1 "Bedroom 1" bedroom rect 3.5,0 4x4
room bed2 "Bedroom 2" bedroom rect 7.5,0 3x2
room bathroom "Bathroom" wc rect 7.5,2 3x2

stairs main "Main Stair"
  at ground in:hall rect 2,0.5 1.5x2.5
  at first in:landing rect 2,0.3 1.5x1.4

door hall.west w0.9 entrance
door hall>living w0.9 hinge:start swing:living
door hall>kitchen w0.9 hinge:start swing:kitchen
door landing>bed1 w0.8 hinge:start swing:bed1
door landing>bed2 w0.8 hinge:start swing:bed2
door landing>bathroom w0.7 hinge:end swing:bathroom
