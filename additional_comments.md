## Things to improve

1. *Images are currently hardcoded* - if we decide to add an endpoint in the UI that adds images, I will make the images scan scheduler logic based on the DB state.
At startup, it will create scan tasks for the existing images in the DB, and each time we add a new image, it will create a new scan task and execute it immidiately.
2. *Consts* - I think potentially we could add more consts, but since I didn't really notice it until the end and didn't have time to improve it I decided this can be a point to improve.
We can create `consts` files for each folder containing compenents with consts like `trivy_scanner/consts.ts`.
This would make it easier to understand what each number means and easy to find and modify in the future.
3. *Docker Compose environment vs .env files* - in production, we would never want to use the environment as it might reveal important and sensitive information such as urls for databases, secrets (like passwords, usernames, open ports/urls) and more stuff that can be utilized by attackers to expose the system.
The `.env` files are unique to each customer or if it's a centralized web system it's never pushed to git, making it the much safer option. 
Since this is a home assignment, I thought it would be the simplest to just do it like this.
4. *Git* - I did it all on the same branch.
Ideally, I would do each feature/part on a separate branch and then merge it to the development branch, but it seemed redundant for the home assignement specifically.
5. *Base Node Dockerfile* - both the api and the bullmq images have similar logic, that could be an image in a repo that is built once using CD features as a base node image, and the api/bullmq services can inherit from it.
Seemed a bit overkill for this assignment, so I avoided implementing that, but this would be the right thing to do in production.