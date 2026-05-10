## Things to improve

1. *Images are currently hardcoded* - if we decide to add an endpoint in the UI that adds images, I will make the images scan scheduler logic based on the DB state.
At startup, it will create scan tasks for the existing images in the DB, and each time we add a new image, it will create a new scan task and execute it immidiately.
2. *Scannner Extensibility* - Since I don't have a general idea of how other scan services will look like, it's hard to create a baseline that all scanners should follow, but I would improve that as well if I were to know how they would look like.
So to summerise, design I've done is not fully extensible, but since we use the bullmq scheduler, it will be easy to add new scheduled scanner tasks in the future.
3. *Consts* - I think potentially we could add more consts, but since I didn't really notice it until the end and didn't have time to improve it I decided this can be a point to improve.
We can create `consts` files for each folder containing compenents with consts like `trivy_scanner/consts.ts`.
This would make it easier to understand what each number means and easy to find and modify in the future.
4. *Docker Compose environment vs .env files* - in production, we would never want to use the environment as it might reveal important and sensitive information such as urls for databases, secrets (like passwords, usernames, open ports/urls) and more stuff that can be utilized by attackers to expose the system.
The `.env` files are unique to each customer or if it's a centralized web system it's never pushed to git, making it the much safer option. 
Since this is a home assignment, I thought it would be the simplest to just do it like this.
5. *Git* - I did it all on the same branch.
Ideally, I would do each feature/part on a separate branch and then merge it to the development branch, but it seemed redundant for the home assignement specifically.