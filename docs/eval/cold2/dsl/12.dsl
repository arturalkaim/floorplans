plan "Flat on a Grid"

grid cols 3,3 rows 3,3

level ground ground

room living "Living Room" living
room bedroom "Bedroom" bedroom
room hall "Hall" hall circulation
room bathroom "Bathroom" wc

layout
  living bedroom
  hall bathroom

door hall>living w0.9 hinge:start swing:living
door hall>bedroom w0.8 hinge:start swing:bedroom
door hall>bathroom w0.7 hinge:end swing:bathroom
